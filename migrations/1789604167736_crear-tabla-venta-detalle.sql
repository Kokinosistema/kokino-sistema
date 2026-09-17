-- Up Migration

CREATE TABLE venta_detalle (
  id_venta_detalle          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_venta                  INTEGER NOT NULL REFERENCES ventas (id_venta) ON DELETE CASCADE,
  id_producto               INTEGER NOT NULL REFERENCES productos (id_producto) ON DELETE RESTRICT,
  cantidad                  NUMERIC(12,3) NOT NULL,
  precio_unitario_aplicado  NUMERIC(12,2) NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT venta_detalle_cantidad_check
    CHECK (cantidad > 0),
  CONSTRAINT venta_detalle_precio_check
    CHECK (precio_unitario_aplicado >= 0)
);

CREATE INDEX venta_detalle_id_venta_idx ON venta_detalle (id_venta);
CREATE INDEX venta_detalle_id_producto_idx ON venta_detalle (id_producto);

CREATE TRIGGER trg_venta_detalle_set_updated_at
  BEFORE UPDATE ON venta_detalle
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE venta_detalle IS
  'Líneas de cada venta. No guarda el subtotal, que es la cantidad por el precio, pero sí el precio aplicado.';
COMMENT ON COLUMN venta_detalle.precio_unitario_aplicado IS
  'Lo que realmente se cobró por unidad. Se guarda aunque exista la tabla de precios, porque puede no coincidir con la lista: un descuento puntual o un acuerdo con un mayorista hacen que el precio cobrado sea propio de esa venta.';
COMMENT ON COLUMN venta_detalle.cantidad IS
  'Admite decimales porque el helado a peso se vende fraccionado. No se registra qué gustos eligió el cliente: eso no se sigue en Kokino, solo la cantidad.';

-- Down Migration

DROP TABLE venta_detalle;
