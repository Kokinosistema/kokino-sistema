-- Up Migration

-- Arreglo urgente (2026-10-07). La migracion de turnos paso cajas.turno a
-- VARCHAR(20) con valores como 'MANANA_TARDE' (12 letras), pero
-- validar_caja_abierta() leia el turno en una variable VARCHAR(10): cada
-- venta, pago o egreso de una caja abierta fallaba con "el valor es
-- demasiado largo". Ahora la variable toma el tipo de la columna, asi no
-- vuelve a pasar si el turno cambia.

CREATE OR REPLACE FUNCTION validar_caja_abierta() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cierre TIMESTAMPTZ;
  v_turno  cajas.turno%TYPE;
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
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION validar_caja_abierta() RETURNS trigger
LANGUAGE plpgsql AS $$
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
$$;
