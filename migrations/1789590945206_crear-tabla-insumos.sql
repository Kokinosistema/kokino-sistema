-- Up Migration

CREATE TABLE insumos (
  id_insumo         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre            VARCHAR(150) NOT NULL UNIQUE,
  id_categoria      INTEGER NOT NULL,
  tipo_categoria    VARCHAR(20) NOT NULL DEFAULT 'INSUMO',
  id_unidad_medida  INTEGER NOT NULL REFERENCES unidades_medida (id_unidad) ON DELETE RESTRICT,
  stock_minimo      NUMERIC(12,3) NOT NULL DEFAULT 0,
  perecedero        BOOLEAN NOT NULL DEFAULT false,
  activo            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT insumos_tipo_categoria_check
    CHECK (tipo_categoria = 'INSUMO'),
  CONSTRAINT insumos_stock_minimo_check
    CHECK (stock_minimo >= 0),
  CONSTRAINT insumos_id_categoria_fkey
    FOREIGN KEY (id_categoria, tipo_categoria)
    REFERENCES categorias (id_categoria, tipo)
    ON DELETE RESTRICT
);

CREATE INDEX insumos_id_categoria_idx ON insumos (id_categoria);
CREATE INDEX insumos_id_unidad_medida_idx ON insumos (id_unidad_medida);

CREATE TRIGGER trg_insumos_set_updated_at
  BEFORE UPDATE ON insumos
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE insumos IS
  'Todo lo que Kokino compra a proveedores: materia prima del helado, envases, cucuruchos, productos de cafetería y repostería.';
COMMENT ON COLUMN insumos.tipo_categoria IS
  'Fija en INSUMO por CHECK. Junto con id_categoria forma la FK compuesta contra categorias (id_categoria, tipo), que impide asociar un insumo a una categoría de productos.';
COMMENT ON COLUMN insumos.id_unidad_medida IS
  'Unidad en la que se compra y se stockea este insumo. Las recetas pueden expresarlo en otra unidad de la misma magnitud y convertirlo con unidades_medida.factor_a_base.';
COMMENT ON COLUMN insumos.stock_minimo IS
  'Umbral de reposición: por debajo de esta cantidad el insumo debería reponerse. Cero significa que no se controla.';
COMMENT ON COLUMN insumos.perecedero IS
  'true si el insumo vence y por lo tanto requiere seguimiento de lotes con fecha de vencimiento.';

-- Down Migration

DROP TABLE insumos;
