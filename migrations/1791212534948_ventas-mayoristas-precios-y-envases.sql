-- Up Migration

-- Venta mayorista de tachos, definida con la usuaria el 2026-10-05 mientras
-- los duenos responden como fijan el precio:
--
--   1. Lista de precios mayoristas por linea (artesanal / familiar) y envase
--      (incluido / retornable). Es un precio sugerido: en cada venta viene
--      puesto y se puede cambiar, asi entran descuentos por cantidad o
--      precios especiales. Lo que vale es el precio aplicado de cada tacho
--      (venta_tachos.precio_aplicado), que ya existia.
--   2. Devoluciones de envases: los tachos retornables que el mayorista
--      devuelve. Lo que debe es lo retornable vendido menos lo devuelto.
--   3. La venta mayorista tiene su propio canal, para no mezclarse con los
--      canales del mostrador.
--   4. Un tacho solo se vende desde la sucursal donde esta.
--
-- Los precios MAYORISTA_ENVASE_* de la tabla precios (por producto) quedan
-- sin usar: un tacho es un sabor, no un producto.

-- --------------------------------------------------------- precios mayoristas

CREATE TABLE precios_mayoristas (
  id_precio_mayorista  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  linea                VARCHAR(20)   NOT NULL,
  envase               VARCHAR(20)   NOT NULL,
  precio               NUMERIC(12,2) NOT NULL,
  fecha_vigencia_desde DATE          NOT NULL DEFAULT current_date,
  fecha_vigencia_hasta DATE,
  id_usuario           INTEGER       NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT precios_mayoristas_linea_check CHECK (linea IN ('ARTESANAL', 'FAMILIAR')),
  CONSTRAINT precios_mayoristas_envase_check CHECK (envase IN ('INCLUIDO', 'RETORNABLE')),
  CONSTRAINT precios_mayoristas_precio_check CHECK (precio >= 0),
  CONSTRAINT precios_mayoristas_vigencia_check
    CHECK (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= fecha_vigencia_desde)
);

COMMENT ON TABLE precios_mayoristas IS
  'Precio sugerido de un tacho para mayoristas, por linea y envase. Historico: el vigente es el que no tiene fecha_vigencia_hasta. En la venta se puede cambiar; lo cobrado queda en venta_tachos.precio_aplicado.';

-- Un solo precio vigente por linea y envase.
CREATE UNIQUE INDEX precios_mayoristas_vigente_idx
  ON precios_mayoristas (linea, envase) WHERE fecha_vigencia_hasta IS NULL;
CREATE INDEX precios_mayoristas_id_usuario_idx ON precios_mayoristas (id_usuario);

CREATE TRIGGER trg_precios_mayoristas_set_updated_at
  BEFORE UPDATE ON precios_mayoristas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------ devoluciones de envases

CREATE TABLE devoluciones_envases (
  id_devolucion        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_cliente           INTEGER     NOT NULL REFERENCES clientes (id_cliente) ON DELETE RESTRICT,
  cantidad             INTEGER     NOT NULL,
  fecha_hora           TIMESTAMPTZ NOT NULL DEFAULT now(),
  id_usuario           INTEGER     NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  observaciones        TEXT,
  fecha_anulacion      TIMESTAMPTZ,
  id_usuario_anulacion INTEGER REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  motivo_anulacion     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT devoluciones_envases_cantidad_check CHECK (cantidad > 0),
  CONSTRAINT devoluciones_envases_anulacion_completa_check
    CHECK ((fecha_anulacion IS NULL AND id_usuario_anulacion IS NULL AND motivo_anulacion IS NULL)
        OR (fecha_anulacion IS NOT NULL AND id_usuario_anulacion IS NOT NULL
            AND btrim(coalesce(motivo_anulacion, '')) <> ''))
);

COMMENT ON TABLE devoluciones_envases IS
  'Tachos retornables que un mayorista devolvio. Lo que debe = tachos RETORNABLE de sus ventas no anuladas - devoluciones no anuladas. Una devolucion mal cargada se anula con motivo, no se borra.';

CREATE INDEX devoluciones_envases_id_cliente_idx ON devoluciones_envases (id_cliente);
CREATE INDEX devoluciones_envases_id_usuario_idx ON devoluciones_envases (id_usuario);
CREATE INDEX devoluciones_envases_id_usuario_anulacion_idx ON devoluciones_envases (id_usuario_anulacion);

CREATE TRIGGER trg_devoluciones_envases_set_updated_at
  BEFORE UPDATE ON devoluciones_envases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Solo se puede anular, y una sola vez: el resto de la fila no cambia.
CREATE FUNCTION congelar_devolucion_de_envases() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Una devolucion de envases no se borra: si esta mal, se anula con el motivo';
  END IF;
  IF OLD.fecha_anulacion IS NOT NULL THEN
    RAISE EXCEPTION 'La devolucion % ya esta anulada y no se modifica', OLD.id_devolucion;
  END IF;
  IF NEW.id_cliente <> OLD.id_cliente OR NEW.cantidad <> OLD.cantidad OR NEW.fecha_hora <> OLD.fecha_hora
     OR NEW.id_usuario <> OLD.id_usuario OR NEW.observaciones IS DISTINCT FROM OLD.observaciones THEN
    RAISE EXCEPTION 'Una devolucion de envases no se edita: si esta mal, se anula y se carga de nuevo';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_devoluciones_envases_congelar
  BEFORE UPDATE OR DELETE ON devoluciones_envases
  FOR EACH ROW EXECUTE FUNCTION congelar_devolucion_de_envases();

-- ------------------------------------------------------ canal de la venta mayorista

ALTER TABLE ventas DROP CONSTRAINT ventas_canal_check;
ALTER TABLE ventas
  ADD CONSTRAINT ventas_canal_check
    CHECK (canal_venta IN ('MOSTRADOR', 'TELEFONO', 'PEDIDOSYA', 'MAYORISTA')),
  ADD CONSTRAINT ventas_canal_segun_tipo_check
    CHECK ((tipo_venta = 'MAYORISTA') = (canal_venta = 'MAYORISTA'));

-- ------------------------------------------- el tacho se vende desde donde esta

CREATE OR REPLACE FUNCTION entregar_tacho_a_mayorista() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_tipo_venta VARCHAR(20);
  v_sucursal   INTEGER;
  v_estado     VARCHAR(20);
  v_donde      INTEGER;
BEGIN
  SELECT tipo_venta, id_sucursal INTO v_tipo_venta, v_sucursal
    FROM ventas WHERE id_venta = NEW.id_venta;

  IF v_tipo_venta <> 'MAYORISTA' THEN
    RAISE EXCEPTION 'La venta % no es mayorista: el helado a peso se vende por mostrador, no por tacho entero', NEW.id_venta;
  END IF;

  SELECT estado, id_sucursal INTO v_estado, v_donde
    FROM tachos WHERE id_tacho = NEW.id_tacho;

  IF v_estado <> 'LLENO' THEN
    RAISE EXCEPTION 'El tacho % esta en estado % y solo se puede entregar uno LLENO', NEW.id_tacho, v_estado;
  END IF;

  IF v_donde <> v_sucursal THEN
    RAISE EXCEPTION 'El tacho % esta en la sucursal % y la venta es de la sucursal %: se vende desde donde esta', NEW.id_tacho, v_donde, v_sucursal;
  END IF;

  UPDATE tachos SET estado = 'ENTREGADO_MAYORISTA' WHERE id_tacho = NEW.id_tacho;

  RETURN NEW;
END;
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION entregar_tacho_a_mayorista() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_tipo_venta VARCHAR(20);
  v_estado     VARCHAR(20);
BEGIN
  SELECT tipo_venta INTO v_tipo_venta
    FROM ventas WHERE id_venta = NEW.id_venta;

  IF v_tipo_venta <> 'MAYORISTA' THEN
    RAISE EXCEPTION 'La venta % no es mayorista: el helado a peso se vende por mostrador, no por tacho entero', NEW.id_venta;
  END IF;

  SELECT estado INTO v_estado
    FROM tachos WHERE id_tacho = NEW.id_tacho;

  IF v_estado <> 'LLENO' THEN
    RAISE EXCEPTION 'El tacho % esta en estado % y solo se puede entregar uno LLENO', NEW.id_tacho, v_estado;
  END IF;

  UPDATE tachos SET estado = 'ENTREGADO_MAYORISTA' WHERE id_tacho = NEW.id_tacho;

  RETURN NEW;
END;
$$;

ALTER TABLE ventas DROP CONSTRAINT ventas_canal_segun_tipo_check;
ALTER TABLE ventas DROP CONSTRAINT ventas_canal_check;
ALTER TABLE ventas
  ADD CONSTRAINT ventas_canal_check
    CHECK (canal_venta IN ('MOSTRADOR', 'TELEFONO', 'PEDIDOSYA'));

DROP TABLE devoluciones_envases;
DROP FUNCTION congelar_devolucion_de_envases();
DROP TABLE precios_mayoristas;
