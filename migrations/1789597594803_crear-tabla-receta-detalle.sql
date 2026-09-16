-- Up Migration

CREATE TABLE receta_detalle (
  id_receta_detalle  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_receta          INTEGER NOT NULL REFERENCES recetas (id_receta) ON DELETE CASCADE,
  id_insumo          INTEGER NOT NULL REFERENCES insumos (id_insumo) ON DELETE RESTRICT,
  fase               VARCHAR(10) NOT NULL,
  cantidad_necesaria NUMERIC(12,3) NOT NULL,
  id_unidad_medida   INTEGER NOT NULL REFERENCES unidades_medida (id_unidad) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT receta_detalle_fase_check
    CHECK (fase IN ('TINA', 'TACHO')),
  CONSTRAINT receta_detalle_cantidad_check
    CHECK (cantidad_necesaria > 0),
  CONSTRAINT receta_detalle_insumo_fase_key
    UNIQUE (id_receta, id_insumo, fase)
);

CREATE INDEX receta_detalle_id_receta_idx ON receta_detalle (id_receta);
CREATE INDEX receta_detalle_id_insumo_idx ON receta_detalle (id_insumo);

CREATE TRIGGER trg_receta_detalle_set_updated_at
  BEFORE UPDATE ON receta_detalle
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE receta_detalle IS
  'Ingredientes de cada fórmula, con la cantidad y el momento del proceso en que se incorporan.';
COMMENT ON COLUMN receta_detalle.fase IS
  'Momento en que entra el ingrediente. TINA: va en la mezcla base que pasa por la máquina (leche, azúcar, estabilizante). TACHO: se agrega recién al fraccionar, sobre el helado ya hecho (nueces enteras, chocolate para granizar). La distinción importa porque la fase TACHO se consume por tacho y no por tanda.';
COMMENT ON COLUMN receta_detalle.id_unidad_medida IS
  'Unidad en la que la fórmula expresa la cantidad. Puede diferir de la unidad de compra del insumo: se compra en kilos y la receta pide gramos. La conversión sale de unidades_medida.factor_a_base, dentro de la misma magnitud.';
COMMENT ON CONSTRAINT receta_detalle_insumo_fase_key ON receta_detalle IS
  'Un mismo insumo no puede repetirse dos veces en la misma fase de una receta, pero sí puede aparecer una vez en TINA y otra en TACHO.';

-- Down Migration

DROP TABLE receta_detalle;
