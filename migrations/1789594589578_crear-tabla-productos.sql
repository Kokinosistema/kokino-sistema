-- Up Migration

CREATE TABLE productos (
  id_producto       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre            VARCHAR(150) NOT NULL UNIQUE,
  id_categoria      INTEGER NOT NULL,
  tipo_categoria    VARCHAR(20) NOT NULL DEFAULT 'PRODUCTO',
  tipo_origen       VARCHAR(30) NOT NULL,
  id_unidad_medida  INTEGER NOT NULL REFERENCES unidades_medida (id_unidad) ON DELETE RESTRICT,
  contenido         NUMERIC(10,3) NOT NULL,
  activo            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT productos_tipo_categoria_check
    CHECK (tipo_categoria = 'PRODUCTO'),
  CONSTRAINT productos_tipo_origen_check
    CHECK (tipo_origen IN ('PRODUCIDO_DESDE_SABOR', 'PRODUCIDO_DIRECTO', 'COMPRADO_TERMINADO')),
  CONSTRAINT productos_contenido_check
    CHECK (contenido > 0),
  CONSTRAINT productos_id_categoria_fkey
    FOREIGN KEY (id_categoria, tipo_categoria)
    REFERENCES categorias (id_categoria, tipo)
    ON DELETE RESTRICT,
  CONSTRAINT productos_id_tipo_origen_key
    UNIQUE (id_producto, tipo_origen)
);

CREATE INDEX productos_id_categoria_idx ON productos (id_categoria);
CREATE INDEX productos_id_unidad_medida_idx ON productos (id_unidad_medida);

CREATE TRIGGER trg_productos_set_updated_at
  BEFORE UPDATE ON productos
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE productos IS
  'Todo lo que Kokino vende al público: helado fraccionado, familiares, cucuruchos, repostería, cafetería.';
COMMENT ON COLUMN productos.tipo_origen IS
  'De dónde sale el producto. PRODUCIDO_DESDE_SABOR: se arma con helado ya producido (térmicos, familiares). PRODUCIDO_DIRECTO: tiene receta propia de insumos (tortas, bombón escocés). COMPRADO_TERMINADO: se compra hecho y se revende (repostería comprada).';
COMMENT ON COLUMN productos.contenido IS
  'Cuánto contiene una unidad de este producto, expresado en id_unidad_medida: un térmico de 1/4 son 0,250 kg, un familiar son 3 o 5 lt, una torta es 1 un.';
COMMENT ON CONSTRAINT productos_id_tipo_origen_key ON productos IS
  'Habilita la FK compuesta desde producto_sabores, para que solo los productos PRODUCIDO_DESDE_SABOR puedan tener gustos asignados.';

-- Down Migration

DROP TABLE productos;
