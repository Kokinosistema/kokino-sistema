-- Up Migration

-- Turnos de la caja (pedido de la usuaria el 2026-10-07): en vez de manana,
-- tarde y noche, dos turnos con su horario:
--   Manana/Tarde: de 10 a 18 h.
--   Tarde/Noche:  de 18 a 1 h (aproximado; cruza la medianoche).
-- Los turnos pasan a una tabla, con sus horas, y la caja apunta a ella. Las
-- cajas que habia (todas de "manana") pasan a Manana/Tarde; tarde y noche,
-- que no tenian ninguna, irian a Tarde/Noche.

CREATE TABLE turnos (
  codigo      VARCHAR(20) PRIMARY KEY,
  nombre      VARCHAR(50) NOT NULL UNIQUE,
  hora_inicio TIME        NOT NULL,
  hora_fin    TIME        NOT NULL,
  orden       SMALLINT    NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT turnos_horas_distintas_check CHECK (hora_inicio <> hora_fin)
);

COMMENT ON TABLE turnos IS
  'Turnos de la caja, con su horario aproximado. Si hora_fin es menor que hora_inicio, el turno cruza la medianoche (Tarde/Noche: de 18 a 1). Sirve para sugerir el turno al abrir la caja segun la hora.';

CREATE TRIGGER trg_turnos_set_updated_at
  BEFORE UPDATE ON turnos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO turnos (codigo, nombre, hora_inicio, hora_fin, orden) VALUES
  ('MANANA_TARDE', 'Mañana/Tarde', '10:00', '18:00', 1),
  ('TARDE_NOCHE',  'Tarde/Noche',  '18:00', '01:00', 2);

ALTER TABLE cajas DROP CONSTRAINT cajas_turno_check;
ALTER TABLE cajas ALTER COLUMN turno TYPE VARCHAR(20);
UPDATE cajas SET turno = CASE turno WHEN 'MANANA' THEN 'MANANA_TARDE' ELSE 'TARDE_NOCHE' END;
ALTER TABLE cajas
  ADD CONSTRAINT cajas_turno_fkey FOREIGN KEY (turno) REFERENCES turnos (codigo) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX cajas_turno_idx ON cajas (turno);

-- Down Migration

DROP INDEX cajas_turno_idx;
ALTER TABLE cajas DROP CONSTRAINT cajas_turno_fkey;
UPDATE cajas SET turno = CASE turno WHEN 'MANANA_TARDE' THEN 'MANANA' ELSE 'NOCHE' END;
ALTER TABLE cajas ALTER COLUMN turno TYPE VARCHAR(10);
ALTER TABLE cajas
  ADD CONSTRAINT cajas_turno_check CHECK (turno IN ('MANANA', 'TARDE', 'NOCHE'));
DROP TABLE turnos;
