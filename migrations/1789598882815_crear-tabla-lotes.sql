-- Up Migration

CREATE TABLE lotes (
  id_lote            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_produccion      INTEGER NOT NULL REFERENCES produccion (id_produccion) ON DELETE RESTRICT,
  codigo_lote        VARCHAR(50) NOT NULL UNIQUE,
  fecha_elaboracion  DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento  DATE NOT NULL,
  cantidad_kg        NUMERIC(12,3) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lotes_cantidad_kg_check
    CHECK (cantidad_kg > 0),
  CONSTRAINT lotes_vencimiento_posterior_check
    CHECK (fecha_vencimiento > fecha_elaboracion)
);

CREATE INDEX lotes_id_produccion_idx ON lotes (id_produccion);
CREATE INDEX lotes_fecha_vencimiento_idx ON lotes (fecha_vencimiento);

CREATE TRIGGER trg_lotes_set_updated_at
  BEFORE UPDATE ON lotes
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE lotes IS
  'Tandas de helado salidas de una producción, antes de fraccionarse en tachos. Solo el helado lleva lote: los insumos y los productos elaborados no se trazan por lote en Kokino.';
COMMENT ON COLUMN lotes.fecha_vencimiento IS
  'Vencimiento del lote, hoy seis meses después de la elaboración. Se guarda en vez de calcularse porque queda impreso en el código de barras de cada tacho: si mañana cambia la política, los lotes viejos tienen que seguir diciendo lo que dice su etiqueta.';
COMMENT ON COLUMN lotes.cantidad_kg IS
  'Kilos que salieron de la máquina para este lote. Los litros no se guardan: son la suma de los tachos que se llenaron con él, así que derivarlos evita que dos números midan lo mismo y se contradigan.';

-- Down Migration

DROP TABLE lotes;
