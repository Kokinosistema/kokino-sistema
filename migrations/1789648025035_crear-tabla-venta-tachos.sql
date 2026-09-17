-- Up Migration

CREATE TABLE venta_tachos (
  id_venta_tacho   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_venta         INTEGER NOT NULL REFERENCES ventas (id_venta) ON DELETE RESTRICT,
  id_tacho         INTEGER NOT NULL REFERENCES tachos (id_tacho) ON DELETE RESTRICT,
  envase           VARCHAR(20) NOT NULL,
  precio_aplicado  NUMERIC(12,2) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT venta_tachos_envase_check
    CHECK (envase IN ('INCLUIDO', 'RETORNABLE')),
  CONSTRAINT venta_tachos_precio_check
    CHECK (precio_aplicado >= 0),
  CONSTRAINT venta_tachos_unico_key
    UNIQUE (id_venta, id_tacho)
);

CREATE INDEX venta_tachos_id_tacho_idx ON venta_tachos (id_tacho);

CREATE TRIGGER trg_venta_tachos_set_updated_at
  BEFORE UPDATE ON venta_tachos
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Saca el tacho del stock al cargarlo en la venta, en lugar de confiar en que la
-- aplicacion se acuerde de hacerlo. Asi el registro de la venta y el estado
-- fisico del tacho no pueden contradecirse.
CREATE FUNCTION entregar_tacho_a_mayorista()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_venta_tachos_entregar
  AFTER INSERT ON venta_tachos
  FOR EACH ROW
  EXECUTE FUNCTION entregar_tacho_a_mayorista();

COMMENT ON TABLE venta_tachos IS
  'Tachos enteros que se lleva un cliente mayorista, identificados por su código de barras. El detalle de venta no sirve para esto porque apunta a productos, y un tacho no es un producto: es una fracción concreta de un lote.';
COMMENT ON COLUMN venta_tachos.precio_aplicado IS
  'Lo que se cobró por este tacho. Se guarda acá y no en venta_detalle porque el total de una venta mayorista sale de sus tachos. Como en el detalle minorista, puede no coincidir con la lista de precios: un acuerdo puntual con un mayorista es propio de esa venta.';
COMMENT ON COLUMN venta_tachos.envase IS
  'INCLUIDO si el cliente se queda el tacho y lo paga, RETORNABLE si lo devuelve y por eso paga menos. Explica cuál de los dos precios mayoristas se aplicó. No se sigue si el envase retornable efectivamente volvió: en Kokino eso no se registra.';
COMMENT ON CONSTRAINT venta_tachos_unico_key ON venta_tachos IS
  'El mismo tacho no puede cargarse dos veces en la misma venta. No hay UNIQUE global sobre id_tacho a propósito: si una venta se anula y el tacho vuelve al stock, tiene que poder venderse de nuevo. Que no se venda dos veces al mismo tiempo lo garantiza el estado del tacho, no esta clave.';
COMMENT ON FUNCTION entregar_tacho_a_mayorista() IS
  'Al sumar un tacho a una venta, verifica que la venta sea mayorista y que el tacho esté LLENO, y lo marca ENTREGADO_MAYORISTA. Se exige LLENO porque un tacho EN_POZO ya está abierto vendiéndose por peso y uno VACIO no tiene nada adentro.';

-- Down Migration

DROP TRIGGER trg_venta_tachos_entregar ON venta_tachos;
DROP FUNCTION entregar_tacho_a_mayorista();
DROP TABLE venta_tachos;
