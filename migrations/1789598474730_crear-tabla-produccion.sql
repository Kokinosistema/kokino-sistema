-- Up Migration

CREATE TABLE produccion (
  id_produccion          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_receta              INTEGER NOT NULL REFERENCES recetas (id_receta) ON DELETE RESTRICT,
  id_sucursal            INTEGER NOT NULL REFERENCES sucursales (id_sucursal) ON DELETE RESTRICT,
  id_usuario_responsable INTEGER NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  fecha_produccion       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cantidad_teorica       NUMERIC(12,3) NOT NULL,
  cantidad_real          NUMERIC(12,3) NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT produccion_cantidad_teorica_check
    CHECK (cantidad_teorica > 0),
  CONSTRAINT produccion_cantidad_real_check
    CHECK (cantidad_real >= 0)
);

CREATE INDEX produccion_id_receta_idx ON produccion (id_receta);
CREATE INDEX produccion_id_sucursal_idx ON produccion (id_sucursal);
CREATE INDEX produccion_id_usuario_responsable_idx ON produccion (id_usuario_responsable);
CREATE INDEX produccion_fecha_idx ON produccion (fecha_produccion);

CREATE TRIGGER trg_produccion_set_updated_at
  BEFORE UPDATE ON produccion
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE produccion IS
  'Producciones ya realizadas. Se registran una vez hechas, no se planifican por anticipado, así que no llevan estado. Qué sabor o producto salió no se guarda acá: lo determina la receta usada.';
COMMENT ON COLUMN produccion.id_sucursal IS
  'Sucursal donde se produjo, que hoy es siempre la que tiene la fábrica. Es una FK común a propósito: atarla a tiene_fabrica impediría cambiar ese atributo el día que la fábrica se mude, porque las producciones históricas lo bloquearían.';
COMMENT ON COLUMN produccion.cantidad_teorica IS
  'Cuánto debería haber salido según la fórmula, en la unidad de rendimiento de la receta. Puede ser un múltiplo del rendimiento si se hicieron varias tandas en la misma corrida.';
COMMENT ON COLUMN produccion.cantidad_real IS
  'Cuánto salió efectivamente. La merma no se guarda: es la resta contra cantidad_teorica y se calcula al consultar, para que los tres números no puedan contradecirse.';

-- Down Migration

DROP TABLE produccion;
