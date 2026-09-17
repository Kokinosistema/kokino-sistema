-- Up Migration

CREATE TABLE precios (
  id_precio             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_producto           INTEGER NOT NULL REFERENCES productos (id_producto) ON DELETE RESTRICT,
  tipo_precio           VARCHAR(30) NOT NULL,
  precio                NUMERIC(12,2) NOT NULL,
  fecha_vigencia_desde  DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vigencia_hasta  DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT precios_tipo_check
    CHECK (tipo_precio IN ('MINORISTA', 'MAYORISTA_ENVASE_INCLUIDO', 'MAYORISTA_ENVASE_RETORNABLE')),
  CONSTRAINT precios_precio_check
    CHECK (precio >= 0),
  CONSTRAINT precios_vigencia_coherente_check
    CHECK (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= fecha_vigencia_desde)
);

-- Un solo precio vigente por producto y tipo. Los precios cerrados quedan
-- fuera del índice, así el historial puede tener todos los que haga falta.
CREATE UNIQUE INDEX precios_vigente_uidx
  ON precios (id_producto, tipo_precio)
  WHERE fecha_vigencia_hasta IS NULL;

CREATE INDEX precios_id_producto_idx ON precios (id_producto);

CREATE TRIGGER trg_precios_set_updated_at
  BEFORE UPDATE ON precios
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE precios IS
  'Precios de venta vigentes e históricos. Un aumento no pisa el precio anterior: se cierra el viejo y se abre uno nuevo, para que las ventas pasadas se sigan pudiendo valuar con el precio que realmente tenían. Los precios no dependen de la sucursal: un producto vale lo mismo en las dos.';
COMMENT ON COLUMN precios.tipo_precio IS
  'MINORISTA para la venta al público. Los dos precios mayoristas se diferencian por el envase: ENVASE_INCLUIDO cuando el cliente se queda el tacho y lo paga, ENVASE_RETORNABLE cuando lo devuelve y por eso paga menos. No todo producto necesita los tres tipos.';
COMMENT ON COLUMN precios.id_producto IS
  'El precio va en el producto y no depende de la línea, porque cada producto pertenece a una sola: el pozo del que salen los térmicos es artesanal, y los envases familiares y el tacho mayorista de 10 litros son de la línea familiar.';

-- Down Migration

DROP TABLE precios;
