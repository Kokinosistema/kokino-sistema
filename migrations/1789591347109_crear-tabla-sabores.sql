-- Up Migration

CREATE TABLE sabores (
  id_sabor               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre                 VARCHAR(100) NOT NULL UNIQUE,
  id_categoria           INTEGER NOT NULL,
  tipo_categoria         VARCHAR(20) NOT NULL DEFAULT 'SABOR',
  densidad_kg_por_litro  NUMERIC(4,3),
  kg_por_tina            NUMERIC(8,3),
  prioridad_produccion   VARCHAR(10) NOT NULL,
  activo                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sabores_tipo_categoria_check
    CHECK (tipo_categoria = 'SABOR'),
  CONSTRAINT sabores_prioridad_produccion_check
    CHECK (prioridad_produccion IN ('CLARO', 'OSCURO')),
  CONSTRAINT sabores_densidad_check
    CHECK (densidad_kg_por_litro > 0.5 AND densidad_kg_por_litro < 1.0),
  CONSTRAINT sabores_kg_por_tina_check
    CHECK (kg_por_tina > 0),
  CONSTRAINT sabores_id_categoria_fkey
    FOREIGN KEY (id_categoria, tipo_categoria)
    REFERENCES categorias (id_categoria, tipo)
    ON DELETE RESTRICT
);

CREATE INDEX sabores_id_categoria_idx ON sabores (id_categoria);

CREATE TRIGGER trg_sabores_set_updated_at
  BEFORE UPDATE ON sabores
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE sabores IS
  'Sabores de helado que Kokino produce. Se producen midiendo kilos y se venden midiendo litros.';
COMMENT ON COLUMN sabores.densidad_kg_por_litro IS
  'Kilos que pesa un litro de este sabor, usado para convertir la producción (en kg) a litros vendibles. En Kokino va de 0,67 a 0,74. El helado siempre pesa menos que el agua porque lleva aire incorporado, de ahí el tope de 1,0 del CHECK. Nulo mientras no se haya medido: sin este dato no se puede fraccionar el lote en tachos.';
COMMENT ON COLUMN sabores.kg_por_tina IS
  'Kilos que rinde una tina de este sabor en las máquinas no continuas. Nulo para sabores que solo se hacen en máquina continua, donde no hay tanda.';
COMMENT ON COLUMN sabores.prioridad_produccion IS
  'Orden de producción dentro de la jornada: primero los CLARO y después los OSCURO, para que un sabor claro no salga manchado por el anterior.';

-- Down Migration

DROP TABLE sabores;
