-- Up Migration

-- Costo de compra de los productos que Kokino revende. Va en tabla propia y no
-- en precios porque son cosas distintas: precios guarda lo que el cliente
-- paga, esto guarda lo que Kokino pago. Mezclarlos en una sola tabla haria que
-- cualquier consulta que se olvide de filtrar muestre un costo como si fuera
-- un precio de venta, y un numero plausible pero equivocado es peor que un
-- error que se ve.
--
-- Por ahora solo se cargan costos de la reposteria comprada, que es donde los
-- duenos miran el margen. No se restringe por tipo de producto: que hoy solo
-- la reposteria tenga costo es una decision de alcance, no una regla del
-- negocio, y el dia que quieran cargar otro no deberia hacer falta migrar.
CREATE TABLE costos_producto (
  id_costo              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_producto           INTEGER NOT NULL REFERENCES productos (id_producto) ON DELETE RESTRICT,
  costo                 NUMERIC(12,2) NOT NULL,
  fecha_vigencia_desde  DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vigencia_hasta  DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT costos_producto_costo_check
    CHECK (costo >= 0),
  CONSTRAINT costos_producto_vigencia_coherente_check
    CHECK (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= fecha_vigencia_desde)
);

-- Un solo costo vigente por producto. Los cerrados quedan fuera del indice,
-- asi el historial puede tener todos los que haga falta.
CREATE UNIQUE INDEX costos_producto_vigente_uidx
  ON costos_producto (id_producto)
  WHERE fecha_vigencia_hasta IS NULL;

CREATE TRIGGER trg_costos_producto_set_updated_at
  BEFORE UPDATE ON costos_producto
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE costos_producto IS
  'Lo que a Kokino le cuesta cada producto que revende. Un aumento del proveedor cierra el costo anterior y abre uno nuevo, para poder saber que margen dejaba un producto en cualquier fecha pasada y no solo hoy.';
COMMENT ON COLUMN costos_producto.costo IS
  'Costo por unidad del producto. El margen no se guarda: es el precio de venta vigente menos este costo, y se calcula al consultar para que no pueda quedar viejo cuando cambie cualquiera de los dos.';

-- Down Migration

DROP TABLE costos_producto;
