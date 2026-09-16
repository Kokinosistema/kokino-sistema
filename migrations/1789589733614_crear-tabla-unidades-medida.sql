-- Up Migration

CREATE TABLE unidades_medida (
  id_unidad      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre         VARCHAR(50) NOT NULL UNIQUE,
  abreviatura    VARCHAR(10) NOT NULL UNIQUE,
  magnitud       VARCHAR(20) NOT NULL,
  factor_a_base  NUMERIC(12,4) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unidades_medida_magnitud_check
    CHECK (magnitud IN ('PESO', 'VOLUMEN', 'CONTEO')),
  CONSTRAINT unidades_medida_factor_positivo_check
    CHECK (factor_a_base > 0)
);

CREATE TRIGGER trg_unidades_medida_set_updated_at
  BEFORE UPDATE ON unidades_medida
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE unidades_medida IS
  'Unidades en las que se compran insumos y se miden recetas, producción y ventas.';
COMMENT ON COLUMN unidades_medida.magnitud IS
  'Familia de la unidad. Solo se pueden convertir entre sí unidades de la misma magnitud: pasar de VOLUMEN a PESO en el helado requiere la densidad del sabor, que no es un dato de la unidad.';
COMMENT ON COLUMN unidades_medida.factor_a_base IS
  'Cuántas unidades base equivalen a una de esta. La base de cada magnitud es la unidad más chica: gramo para PESO, mililitro para VOLUMEN, unidad para CONTEO.';

INSERT INTO unidades_medida (nombre, abreviatura, magnitud, factor_a_base) VALUES
  ('Gramo',     'gr', 'PESO',    1),
  ('Kilogramo', 'kg', 'PESO',    1000),
  ('Litro',     'lt', 'VOLUMEN', 1000),
  ('Unidad',    'un', 'CONTEO',  1);

-- Down Migration

DROP TABLE unidades_medida;
