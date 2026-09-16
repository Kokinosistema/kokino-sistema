-- Up Migration

CREATE TABLE traslado_tachos (
  id_traslado_tacho  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_traslado        INTEGER NOT NULL REFERENCES traslados (id_traslado) ON DELETE CASCADE,
  id_tacho           INTEGER NOT NULL REFERENCES tachos (id_tacho) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT traslado_tachos_unico_key
    UNIQUE (id_traslado, id_tacho)
);

CREATE INDEX traslado_tachos_id_tacho_idx ON traslado_tachos (id_tacho);

CREATE TRIGGER trg_traslado_tachos_set_updated_at
  BEFORE UPDATE ON traslado_tachos
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Mueve el tacho al registrar el traslado, en lugar de confiar en que la
-- aplicación se acuerde de hacerlo. Así el historial de traslados y la
-- ubicación del tacho no pueden contradecirse.
CREATE FUNCTION mover_tacho_en_traslado()
RETURNS TRIGGER AS $$
DECLARE
  v_origen           INTEGER;
  v_destino          INTEGER;
  v_ubicacion_actual INTEGER;
  v_estado           VARCHAR(20);
BEGIN
  SELECT id_sucursal_origen, id_sucursal_destino
    INTO v_origen, v_destino
    FROM traslados WHERE id_traslado = NEW.id_traslado;

  SELECT id_sucursal, estado
    INTO v_ubicacion_actual, v_estado
    FROM tachos WHERE id_tacho = NEW.id_tacho;

  IF v_ubicacion_actual <> v_origen THEN
    RAISE EXCEPTION 'El tacho % no está en la sucursal de origen del traslado', NEW.id_tacho;
  END IF;

  IF v_estado = 'VACIO' THEN
    RAISE EXCEPTION 'No se puede trasladar el tacho %: ya está vacío', NEW.id_tacho;
  END IF;

  UPDATE tachos SET id_sucursal = v_destino WHERE id_tacho = NEW.id_tacho;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_traslado_tachos_mover
  AFTER INSERT ON traslado_tachos
  FOR EACH ROW
  EXECUTE FUNCTION mover_tacho_en_traslado();

COMMENT ON TABLE traslado_tachos IS
  'Tachos incluidos en un traslado. No lleva cantidad: un tacho es un envase identificado, no una cantidad. Es un registro histórico y no debería borrarse, porque el tacho ya quedó movido.';
COMMENT ON FUNCTION mover_tacho_en_traslado() IS
  'Al sumar un tacho a un traslado, verifica que esté en la sucursal de origen y que no esté vacío, y lo reubica en la sucursal de destino.';

-- Down Migration

DROP TRIGGER trg_traslado_tachos_mover ON traslado_tachos;
DROP FUNCTION mover_tacho_en_traslado();
DROP TABLE traslado_tachos;
