-- Up Migration

-- Un egreso mal cargado se corrige anulandolo con motivo y cargandolo de
-- nuevo, igual que una venta. Hasta ahora se podia modificar o borrar
-- cualquier egreso, incluso de una caja cerrada: el arqueo guardado de ese
-- turno dejaba de coincidir con lo que mostraba el sistema, y nadie se
-- enteraba.

ALTER TABLE egresos
  ADD COLUMN id_usuario_anulacion INTEGER REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  ADD COLUMN fecha_anulacion      TIMESTAMPTZ,
  ADD COLUMN motivo_anulacion     TEXT;

CREATE INDEX egresos_id_usuario_anulacion_idx ON egresos (id_usuario_anulacion);

-- Las tres van juntas: un egreso anulado dice quien, cuando y por que. Un
-- motivo de puros espacios cuenta como vacio.
ALTER TABLE egresos
  ADD CONSTRAINT egresos_anulacion_completa_check
  CHECK (
    (id_usuario_anulacion IS NULL AND fecha_anulacion IS NULL AND motivo_anulacion IS NULL)
    OR (id_usuario_anulacion IS NOT NULL AND fecha_anulacion IS NOT NULL
        AND btrim(coalesce(motivo_anulacion, '')) <> '')
  );

ALTER TABLE egresos
  ADD CONSTRAINT egresos_anulacion_posterior_check
  CHECK (fecha_anulacion IS NULL OR fecha_anulacion >= fecha_hora);

-- Un egreso registrado no se borra ni se edita. Lo unico que se le puede
-- hacer es anularlo, una sola vez, y mientras su caja siga abierta: cerrada
-- la caja, su arqueo ya esta hecho y se apoya en estos egresos.
--
-- Corre antes que trg_egresos_set_updated_at (los triggers del mismo momento
-- se disparan por orden alfabetico de nombre), asi que updated_at todavia no
-- cambio cuando se compara; igual no se compara, porque ese lo mueve el otro
-- trigger en cualquier UPDATE.
CREATE FUNCTION congelar_egresos()
RETURNS TRIGGER AS $$
DECLARE
  v_cierre TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un egreso registrado no se borra: si esta mal, se anula con su motivo y se carga de nuevo. Egreso %', OLD.id_egreso;
  END IF;

  IF OLD.fecha_anulacion IS NOT NULL THEN
    RAISE EXCEPTION 'El egreso % ya esta anulado desde el %, asi que no admite mas cambios', OLD.id_egreso, OLD.fecha_anulacion;
  END IF;

  IF NEW.fecha_anulacion IS NULL
     OR NEW.id_caja       IS DISTINCT FROM OLD.id_caja
     OR NEW.id_medio_pago IS DISTINCT FROM OLD.id_medio_pago
     OR NEW.id_usuario    IS DISTINCT FROM OLD.id_usuario
     OR NEW.id_empleado   IS DISTINCT FROM OLD.id_empleado
     OR NEW.tipo_egreso   IS DISTINCT FROM OLD.tipo_egreso
     OR NEW.monto         IS DISTINCT FROM OLD.monto
     OR NEW.descripcion   IS DISTINCT FROM OLD.descripcion
     OR NEW.fecha_hora    IS DISTINCT FROM OLD.fecha_hora
     OR NEW.created_at    IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Un egreso registrado no se edita: lo unico que admite es anularlo. Si el monto o el tipo estaban mal, se anula y se carga de nuevo. Egreso %', OLD.id_egreso;
  END IF;

  SELECT fecha_cierre INTO v_cierre FROM cajas WHERE id_caja = OLD.id_caja;
  IF v_cierre IS NOT NULL THEN
    RAISE EXCEPTION 'La caja del egreso % se cerro el %, asi que ya no se anula: su arqueo esta hecho', OLD.id_egreso, v_cierre;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_egresos_congelar
  BEFORE UPDATE OR DELETE ON egresos
  FOR EACH ROW
  EXECUTE FUNCTION congelar_egresos();

COMMENT ON COLUMN egresos.id_usuario_anulacion IS
  'Quien anulo el egreso. Va junto con fecha_anulacion y motivo_anulacion (egresos_anulacion_completa_check).';
COMMENT ON COLUMN egresos.fecha_anulacion IS
  'Cuando se anulo. Un egreso anulado no cuenta en el arqueo; solo se anula con la caja abierta (trg_egresos_congelar).';
COMMENT ON COLUMN egresos.motivo_anulacion IS
  'Por que se anulo. Obligatorio si el egreso esta anulado.';
COMMENT ON FUNCTION congelar_egresos() IS
  'Impide borrar o editar egresos; solo deja anularlos una vez, con la caja abierta.';

-- Down Migration

DROP TRIGGER trg_egresos_congelar ON egresos;
DROP FUNCTION congelar_egresos();

ALTER TABLE egresos DROP CONSTRAINT egresos_anulacion_posterior_check;
ALTER TABLE egresos DROP CONSTRAINT egresos_anulacion_completa_check;

DROP INDEX egresos_id_usuario_anulacion_idx;

ALTER TABLE egresos
  DROP COLUMN motivo_anulacion,
  DROP COLUMN fecha_anulacion,
  DROP COLUMN id_usuario_anulacion;
