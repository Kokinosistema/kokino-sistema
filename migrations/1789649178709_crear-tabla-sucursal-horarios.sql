-- Up Migration

-- Dos columnas de hora en sucursales no alcanzaban: los locales de Kokino
-- cierran a medianoche de lunes a viernes y a la una los fines de semana, asi
-- que el horario depende del dia y necesita una fila por dia.
CREATE TABLE sucursal_horarios (
  id_sucursal_horario  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_sucursal          INTEGER NOT NULL REFERENCES sucursales (id_sucursal) ON DELETE CASCADE,
  dia_semana           SMALLINT NOT NULL,
  hora_apertura        TIME NOT NULL,
  hora_cierre          TIME NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sucursal_horarios_dia_check
    CHECK (dia_semana BETWEEN 1 AND 7),
  CONSTRAINT sucursal_horarios_dia_unico_key
    UNIQUE (id_sucursal, dia_semana)
);

CREATE INDEX sucursal_horarios_id_sucursal_idx ON sucursal_horarios (id_sucursal);

CREATE TRIGGER trg_sucursal_horarios_set_updated_at
  BEFORE UPDATE ON sucursal_horarios
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE sucursal_horarios IS
  'Horario de atención de cada sucursal, una fila por día de la semana. Un día sin fila es un día en que el local no abre. Alimenta la validación de apertura de caja: no se debería abrir un turno fuera del horario del local.';
COMMENT ON COLUMN sucursal_horarios.dia_semana IS
  'Día de la semana, 1 lunes a 7 domingo. Se guarda como número y no como texto porque es la misma numeración que devuelve EXTRACT(ISODOW FROM fecha) en PostgreSQL: así comparar una fecha contra el horario no necesita ninguna traducción intermedia.';
COMMENT ON COLUMN sucursal_horarios.hora_cierre IS
  'Hora de cierre. Si es menor o igual a hora_apertura, el cierre es del día siguiente: los locales cierran a las 00:00 y a la 01:00, ya en la madrugada del día que sigue. No hay una columna que lo indique a propósito: un dato guardado puede contradecir a las horas, uno deducido de ellas no. Ojo al consultar, porque comparar apertura < hora < cierre sin contemplar esto da que el local nunca está abierto.';

ALTER TABLE sucursales
  DROP COLUMN horario_apertura,
  DROP COLUMN horario_cierre;

-- Down Migration

ALTER TABLE sucursales
  ADD COLUMN horario_apertura TIME,
  ADD COLUMN horario_cierre TIME;

-- Ojo: los horarios por dia se pierden. Las dos columnas que vuelven no pueden
-- representarlos, asi que revertir descarta la diferencia entre semana y fin de
-- semana en lugar de intentar aplastarla en un solo horario que seria falso.
DROP TABLE sucursal_horarios;
