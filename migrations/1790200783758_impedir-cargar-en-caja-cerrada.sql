-- Up Migration

-- Nada impedia cargar una venta, un cobro o un egreso en una caja ya cerrada.
-- El dano es silencioso: el arqueo de ese turno se hizo con otro numero, y el
-- faltante o sobrante que quedo registrado deja de explicarse con lo que la
-- caja tiene adentro.
--
-- Una sola funcion sirve para las tres tablas porque todas guardan id_caja.
-- Cuando la caja es nula no valida nada: la venta mayorista no tiene caja, y
-- un pago por transferencia puede no haber pasado por ninguna.
CREATE FUNCTION validar_caja_abierta()
RETURNS TRIGGER AS $$
DECLARE
  v_cierre TIMESTAMPTZ;
  v_turno  VARCHAR(10);
BEGIN
  IF NEW.id_caja IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT fecha_cierre, turno INTO v_cierre, v_turno
    FROM cajas WHERE id_caja = NEW.id_caja;

  IF v_cierre IS NOT NULL THEN
    RAISE EXCEPTION 'La caja del turno % se cerro el %, asi que no admite mas movimientos: su arqueo ya se hizo con otro numero', v_turno, v_cierre;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ventas_caja_abierta
  BEFORE INSERT OR UPDATE OF id_caja ON ventas
  FOR EACH ROW EXECUTE FUNCTION validar_caja_abierta();

CREATE TRIGGER trg_pagos_venta_caja_abierta
  BEFORE INSERT OR UPDATE OF id_caja ON pagos_venta
  FOR EACH ROW EXECUTE FUNCTION validar_caja_abierta();

CREATE TRIGGER trg_egresos_caja_abierta
  BEFORE INSERT OR UPDATE OF id_caja ON egresos
  FOR EACH ROW EXECUTE FUNCTION validar_caja_abierta();

COMMENT ON FUNCTION validar_caja_abierta() IS
  'Impide registrar ventas, cobros o egresos en una caja ya cerrada, porque su arqueo se hizo con un total que dejaria de coincidir. No valida cuando no hay caja: la venta mayorista no tiene, y un pago por transferencia puede no haber pasado por ninguna.';

-- Down Migration

DROP TRIGGER trg_egresos_caja_abierta ON egresos;
DROP TRIGGER trg_pagos_venta_caja_abierta ON pagos_venta;
DROP TRIGGER trg_ventas_caja_abierta ON ventas;
DROP FUNCTION validar_caja_abierta();
