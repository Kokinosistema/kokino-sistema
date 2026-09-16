-- Up Migration

CREATE TABLE categorias (
  id_categoria  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  tipo          VARCHAR(20) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT categorias_tipo_check
    CHECK (tipo IN ('INSUMO', 'PRODUCTO')),
  CONSTRAINT categorias_nombre_tipo_key
    UNIQUE (nombre, tipo),
  CONSTRAINT categorias_id_tipo_key
    UNIQUE (id_categoria, tipo)
);

CREATE TRIGGER trg_categorias_set_updated_at
  BEFORE UPDATE ON categorias
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE categorias IS
  'Agrupaciones de insumos y de productos. Es una lista plana, sin subcategorías.';
COMMENT ON COLUMN categorias.nombre IS
  'Nombre visible. Un mismo nombre puede existir en los dos tipos: por ejemplo Térmicos es categoría de insumo (el envase vacío que se compra) y de producto (el térmico lleno que se vende).';
COMMENT ON CONSTRAINT categorias_id_tipo_key ON categorias IS
  'Redundante a simple vista, pero necesaria: permite que insumos y productos usen una FK compuesta (id_categoria, tipo) y así la base garantice que un insumo nunca apunte a una categoría de productos.';

INSERT INTO categorias (nombre, tipo) VALUES
  ('Materia prima', 'INSUMO'),
  ('Envases',       'INSUMO'),
  ('Repostería',    'INSUMO'),
  ('Térmicos',      'INSUMO'),
  ('Cucuruchos',    'INSUMO'),
  ('Cafetería',     'INSUMO'),
  ('Familiar',      'PRODUCTO'),
  ('Térmicos',      'PRODUCTO'),
  ('Cucuruchos',    'PRODUCTO'),
  ('Repostería',    'PRODUCTO'),
  ('Cafetería',     'PRODUCTO'),
  ('Línea diet',    'PRODUCTO');

-- Down Migration

DROP TABLE categorias;
