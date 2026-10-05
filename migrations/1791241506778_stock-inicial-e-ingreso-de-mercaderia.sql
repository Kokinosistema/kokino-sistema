-- Up Migration

-- Stock inicial e ingreso de mercaderia (definidos con la usuaria el
-- 2026-10-05):
--
--   1. Los tachos que ya estan en los freezers al arrancar: los cargan los
--      duenos con su sabor y la fecha de vencimiento que figura en el tacho.
--      Van en un lote de STOCK_INICIAL, que no sale de ninguna produccion y
--      no tiene fecha de elaboracion (no se sabe).
--   2. El stock inicial de productos e insumos es un movimiento propio,
--      STOCK_INICIAL. Las correcciones posteriores son RECUENTO.
--   3. La mercaderia que llega de un proveedor se registra como un ingreso
--      (proveedor y remito opcionales, sin precios), y cada renglon es un
--      movimiento ENTRADA_COMPRA atado a ese ingreso.

-- ----------------------------------------------------- lotes de stock inicial

ALTER TABLE lotes
  ADD COLUMN origen VARCHAR(20) NOT NULL DEFAULT 'PRODUCCION',
  ALTER COLUMN id_produccion DROP NOT NULL,
  ALTER COLUMN fecha_elaboracion DROP NOT NULL;

ALTER TABLE lotes
  ADD CONSTRAINT lotes_origen_check CHECK (origen IN ('PRODUCCION', 'STOCK_INICIAL')),
  ADD CONSTRAINT lotes_origen_coherente_check CHECK ((origen = 'PRODUCCION') = (id_produccion IS NOT NULL)),
  ADD CONSTRAINT lotes_elaboracion_segun_origen_check CHECK (origen = 'STOCK_INICIAL' OR fecha_elaboracion IS NOT NULL);

COMMENT ON TABLE lotes IS
  'Tandas de helado salidas de una produccion, antes de fraccionarse en tachos, o los tachos que ya habia al arrancar el sistema (origen STOCK_INICIAL: sin produccion ni fecha de elaboracion, con el sabor y el vencimiento que cargan los duenos). Solo el helado lleva lote: los insumos y los productos elaborados no se trazan por lote en Kokino.';

-- Los triggers del lote leen la produccion: un lote de stock inicial no tiene.
CREATE OR REPLACE FUNCTION validar_lote_de_helado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id_produccion IS NULL THEN
    RETURN NEW;
  END IF;
  IF (SELECT id_sabor FROM produccion WHERE id_produccion = NEW.id_produccion) IS NULL THEN
    RAISE EXCEPTION 'La produccion % no es de un sabor de helado, asi que no puede generar un lote: solo el helado se trazea por lote y se fracciona en tachos', NEW.id_produccion;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION completar_sabor_del_lote() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- El lote de stock inicial trae su sabor: no hay produccion de donde sacarlo.
  IF NEW.id_produccion IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.id_sabor INTO NEW.id_sabor
    FROM produccion p
   WHERE p.id_produccion = NEW.id_produccion;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------ ingresos de mercaderia

CREATE TABLE ingresos_mercaderia (
  id_ingreso     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_sucursal    INTEGER     NOT NULL REFERENCES sucursales (id_sucursal) ON DELETE RESTRICT,
  id_proveedor   INTEGER REFERENCES proveedores (id_proveedor) ON DELETE RESTRICT,
  numero_remito  VARCHAR(50),
  observaciones  TEXT,
  id_usuario     INTEGER     NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  fecha_hora     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ingresos_mercaderia IS
  'Mercaderia que llego de un proveedor a una sucursal, sin precios (las compras se piden por WhatsApp y no se registran). Cada renglon es un movimiento ENTRADA_COMPRA de producto o de insumo con este id_ingreso. Proveedor y remito son opcionales.';

CREATE INDEX ingresos_mercaderia_id_sucursal_idx ON ingresos_mercaderia (id_sucursal, fecha_hora);
CREATE INDEX ingresos_mercaderia_id_proveedor_idx ON ingresos_mercaderia (id_proveedor);
CREATE INDEX ingresos_mercaderia_id_usuario_idx ON ingresos_mercaderia (id_usuario);

CREATE TRIGGER trg_ingresos_mercaderia_set_updated_at
  BEFORE UPDATE ON ingresos_mercaderia
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -------------------------------------------- movimientos: tipos e ingreso

ALTER TABLE movimientos_producto
  ADD COLUMN id_ingreso INTEGER REFERENCES ingresos_mercaderia (id_ingreso) ON DELETE RESTRICT;
ALTER TABLE movimientos_insumo
  ADD COLUMN id_ingreso INTEGER REFERENCES ingresos_mercaderia (id_ingreso) ON DELETE RESTRICT;
CREATE INDEX movimientos_producto_id_ingreso_idx ON movimientos_producto (id_ingreso);
CREATE INDEX movimientos_insumo_id_ingreso_idx ON movimientos_insumo (id_ingreso);

ALTER TABLE movimientos_producto
  DROP CONSTRAINT movimientos_producto_tipo_check,
  DROP CONSTRAINT movimientos_producto_signo_check;
ALTER TABLE movimientos_producto
  ADD CONSTRAINT movimientos_producto_tipo_check
    CHECK (tipo_movimiento IN ('ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'SALIDA_VENTA', 'ANULACION_VENTA',
                               'ENTRADA_TRASLADO', 'SALIDA_TRASLADO', 'AJUSTE', 'RECUENTO', 'STOCK_INICIAL')),
  ADD CONSTRAINT movimientos_producto_signo_check
    CHECK ((tipo_movimiento IN ('ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'ENTRADA_TRASLADO', 'ANULACION_VENTA', 'STOCK_INICIAL') AND cantidad > 0)
        OR (tipo_movimiento IN ('SALIDA_VENTA', 'SALIDA_TRASLADO') AND cantidad < 0)
        OR (tipo_movimiento IN ('AJUSTE', 'RECUENTO'))),
  ADD CONSTRAINT movimientos_producto_ingreso_coherente_check
    CHECK ((tipo_movimiento = 'ENTRADA_COMPRA') = (id_ingreso IS NOT NULL));

ALTER TABLE movimientos_insumo
  DROP CONSTRAINT movimientos_insumo_tipo_check,
  DROP CONSTRAINT movimientos_insumo_signo_check;
ALTER TABLE movimientos_insumo
  ADD CONSTRAINT movimientos_insumo_tipo_check
    CHECK (tipo_movimiento IN ('ENTRADA_COMPRA', 'CONSUMO_PRODUCCION', 'CONSUMO_VENTA', 'ANULACION_VENTA',
                               'AJUSTE', 'RECUENTO', 'STOCK_INICIAL')),
  ADD CONSTRAINT movimientos_insumo_signo_check
    CHECK ((tipo_movimiento IN ('ENTRADA_COMPRA', 'ANULACION_VENTA', 'STOCK_INICIAL') AND cantidad > 0)
        OR (tipo_movimiento IN ('CONSUMO_PRODUCCION', 'CONSUMO_VENTA') AND cantidad < 0)
        OR (tipo_movimiento IN ('AJUSTE', 'RECUENTO'))),
  ADD CONSTRAINT movimientos_insumo_ingreso_coherente_check
    CHECK ((tipo_movimiento = 'ENTRADA_COMPRA') = (id_ingreso IS NOT NULL));

-- Down Migration

ALTER TABLE movimientos_insumo
  DROP CONSTRAINT movimientos_insumo_ingreso_coherente_check,
  DROP CONSTRAINT movimientos_insumo_tipo_check,
  DROP CONSTRAINT movimientos_insumo_signo_check;
ALTER TABLE movimientos_insumo
  ADD CONSTRAINT movimientos_insumo_tipo_check
    CHECK (tipo_movimiento IN ('ENTRADA_COMPRA', 'CONSUMO_PRODUCCION', 'CONSUMO_VENTA', 'ANULACION_VENTA', 'AJUSTE', 'RECUENTO')),
  ADD CONSTRAINT movimientos_insumo_signo_check
    CHECK ((tipo_movimiento IN ('ENTRADA_COMPRA', 'ANULACION_VENTA') AND cantidad > 0)
        OR (tipo_movimiento IN ('CONSUMO_PRODUCCION', 'CONSUMO_VENTA') AND cantidad < 0)
        OR (tipo_movimiento IN ('AJUSTE', 'RECUENTO')));

ALTER TABLE movimientos_producto
  DROP CONSTRAINT movimientos_producto_ingreso_coherente_check,
  DROP CONSTRAINT movimientos_producto_tipo_check,
  DROP CONSTRAINT movimientos_producto_signo_check;
ALTER TABLE movimientos_producto
  ADD CONSTRAINT movimientos_producto_tipo_check
    CHECK (tipo_movimiento IN ('ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'SALIDA_VENTA', 'ANULACION_VENTA',
                               'ENTRADA_TRASLADO', 'SALIDA_TRASLADO', 'AJUSTE', 'RECUENTO')),
  ADD CONSTRAINT movimientos_producto_signo_check
    CHECK ((tipo_movimiento IN ('ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'ENTRADA_TRASLADO', 'ANULACION_VENTA') AND cantidad > 0)
        OR (tipo_movimiento IN ('SALIDA_VENTA', 'SALIDA_TRASLADO') AND cantidad < 0)
        OR (tipo_movimiento IN ('AJUSTE', 'RECUENTO')));

ALTER TABLE movimientos_insumo DROP COLUMN id_ingreso;
ALTER TABLE movimientos_producto DROP COLUMN id_ingreso;
DROP TABLE ingresos_mercaderia;

CREATE OR REPLACE FUNCTION completar_sabor_del_lote() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT p.id_sabor INTO NEW.id_sabor
    FROM produccion p
   WHERE p.id_produccion = NEW.id_produccion;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validar_lote_de_helado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT id_sabor FROM produccion WHERE id_produccion = NEW.id_produccion) IS NULL THEN
    RAISE EXCEPTION 'La produccion % no es de un sabor de helado, asi que no puede generar un lote: solo el helado se trazea por lote y se fracciona en tachos', NEW.id_produccion;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON TABLE lotes IS
  'Tandas de helado salidas de una producción, antes de fraccionarse en tachos. Solo el helado lleva lote: los insumos y los productos elaborados no se trazan por lote en Kokino.';

ALTER TABLE lotes
  DROP CONSTRAINT lotes_elaboracion_segun_origen_check,
  DROP CONSTRAINT lotes_origen_coherente_check,
  DROP CONSTRAINT lotes_origen_check;
ALTER TABLE lotes
  ALTER COLUMN fecha_elaboracion SET NOT NULL,
  ALTER COLUMN id_produccion SET NOT NULL,
  DROP COLUMN origen;
