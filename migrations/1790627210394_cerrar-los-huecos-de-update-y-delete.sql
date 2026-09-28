-- Up Migration

-- Todos los triggers de negocio cubrian el INSERT y dejaban afuera el UPDATE y
-- el DELETE. Eso no era un descuido puntual sino el mismo hueco visto desde
-- cuatro angulos: se podia agregar una linea a una venta ya anulada,
-- desanularla y volver a anularla inventando stock, corregir una linea sin que
-- el stock se enterara, asignarle el lote a un tacho salteando las
-- validaciones, y reabrir una caja ya arqueada.
--
-- Se cierran los cuatro con la misma idea: lo que ya quedo registrado no se
-- toca, y lo que esta cerrado no se reabre.

-- 1. Las lineas de una venta son inmutables. Si algo salio mal se anula la
-- venta y se hace de nuevo, que es la decision que ya estaba tomada para la
-- venta entera. Consecuencia para la aplicacion: el carrito se arma en memoria
-- y entra a la base al confirmar, no linea por linea mientras se tipea.
CREATE FUNCTION congelar_lineas_de_venta()
RETURNS TRIGGER AS $$
DECLARE
  v_anulada TIMESTAMPTZ;
  v_venta   INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Una venta registrada no se edita ni se borra por partes: si esta mal, se anula entera y se hace de nuevo. Tabla %', TG_TABLE_NAME;
  END IF;

  v_venta := NEW.id_venta;
  SELECT fecha_anulacion INTO v_anulada FROM ventas WHERE id_venta = v_venta;

  IF v_anulada IS NOT NULL THEN
    RAISE EXCEPTION 'La venta % esta anulada desde el %, asi que no admite mas movimientos', v_venta, v_anulada;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_venta_detalle_congelar
  BEFORE INSERT OR UPDATE OR DELETE ON venta_detalle
  FOR EACH ROW EXECUTE FUNCTION congelar_lineas_de_venta();

CREATE TRIGGER trg_venta_tachos_congelar
  BEFORE INSERT OR UPDATE OR DELETE ON venta_tachos
  FOR EACH ROW EXECUTE FUNCTION congelar_lineas_de_venta();

CREATE TRIGGER trg_pagos_venta_congelar
  BEFORE INSERT OR UPDATE OR DELETE ON pagos_venta
  FOR EACH ROW EXECUTE FUNCTION congelar_lineas_de_venta();

-- 2. Una venta anulada no se desanula, y una venta de una caja ya cerrada no
-- se anula. Lo primero permitia anular, desanular y volver a anular, y como
-- cada anulacion devuelve el stock, se inventaban unidades de la nada. Lo
-- segundo rompia el arqueo del turno, que ya se habia hecho con otro numero:
-- la correccion correcta es una nota de credito con fecha de hoy.
CREATE FUNCTION validar_anulacion_de_venta()
RETURNS TRIGGER AS $$
DECLARE
  v_cierre TIMESTAMPTZ;
BEGIN
  IF OLD.fecha_anulacion IS NOT NULL AND NEW.fecha_anulacion IS NULL THEN
    RAISE EXCEPTION 'Una venta anulada no se puede desanular: la anulacion ya devolvio el stock, y volver atras lo contaria dos veces. Si la venta era buena, hay que cargarla de nuevo';
  END IF;

  IF OLD.fecha_anulacion IS NULL AND NEW.fecha_anulacion IS NOT NULL AND NEW.id_caja IS NOT NULL THEN
    SELECT fecha_cierre INTO v_cierre FROM cajas WHERE id_caja = NEW.id_caja;
    IF v_cierre IS NOT NULL THEN
      RAISE EXCEPTION 'La caja de esta venta se cerro el %, asi que la venta ya no se anula: su arqueo esta hecho. La correccion es una nota de credito con fecha de hoy, y si hay que devolver plata sale como egreso de la caja de hoy', v_cierre;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ventas_validar_anulacion
  BEFORE UPDATE ON ventas
  FOR EACH ROW EXECUTE FUNCTION validar_anulacion_de_venta();

-- 3. Una caja cerrada no se reabre. El monto de cierre guardado es la foto
-- contra la que se hizo el arqueo; reabrirla y seguir cargando hace que esa
-- foto deje de explicar lo que la caja tiene adentro.
CREATE FUNCTION impedir_reabrir_caja()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.fecha_cierre IS NOT NULL AND NEW.fecha_cierre IS NULL THEN
    RAISE EXCEPTION 'Una caja cerrada no se reabre: su arqueo ya se hizo. Lo que quedo afuera del turno va en la caja siguiente';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cajas_impedir_reabrir
  BEFORE UPDATE ON cajas
  FOR EACH ROW EXECUTE FUNCTION impedir_reabrir_caja();

-- 4. Asignarle el lote a un tacho por UPDATE salteaba las dos validaciones que
-- corren al fraccionar: la de densidad y el consumo de los insumos de fase
-- TACHO. Bastaba crear el tacho sin lote, que es el camino legitimo del stock
-- inicial, y despues completarlo.
DROP TRIGGER trg_tachos_validar_densidad ON tachos;
CREATE TRIGGER trg_tachos_validar_densidad
  BEFORE INSERT OR UPDATE OF id_lote ON tachos
  FOR EACH ROW EXECUTE FUNCTION validar_densidad_al_fraccionar();

DROP TRIGGER trg_tachos_consumir_fase_tacho ON tachos;
CREATE TRIGGER trg_tachos_consumir_fase_tacho
  AFTER INSERT OR UPDATE OF id_lote ON tachos
  FOR EACH ROW EXECUTE FUNCTION registrar_consumo_de_fase_tacho();

-- 5. Un cobro que supera lo que vale la venta avisa, no frena. Puede ser un
-- cero de mas al tipear o dos clics en cobrar, pero tambien podria ser un caso
-- legitimo que todavia no conocemos, asi que se lista en vez de bloquearse.
CREATE VIEW alertas_cobros_de_mas AS
SELECT v.id_venta,
       v.fecha_hora,
       vt.total                AS total_de_la_venta,
       sum(p.monto)            AS cobrado,
       sum(p.monto) - vt.total AS de_mas
  FROM ventas v
  JOIN ventas_totales vt ON vt.id_venta = v.id_venta
  JOIN pagos_venta p     ON p.id_venta  = v.id_venta
 WHERE v.fecha_anulacion IS NULL
 GROUP BY v.id_venta, v.fecha_hora, vt.total
HAVING sum(p.monto) > vt.total;

COMMENT ON VIEW alertas_cobros_de_mas IS
  'Ventas donde lo cobrado supera lo que la venta vale. Casi siempre es un error de tipeo o un doble clic en cobrar, y se ve al arquear la caja porque el efectivo no va a estar. Se avisa y no se bloquea por si existe algun caso legitimo, como una sena, que todavia no se modelo.';

COMMENT ON FUNCTION congelar_lineas_de_venta() IS
  'Impide editar o borrar las lineas, los tachos y los cobros de una venta, y agregarle cualquiera de las tres si esta anulada. Una venta mal cargada se anula entera y se hace de nuevo.';

-- Down Migration

DROP VIEW alertas_cobros_de_mas;

DROP TRIGGER trg_tachos_consumir_fase_tacho ON tachos;
CREATE TRIGGER trg_tachos_consumir_fase_tacho
  AFTER INSERT ON tachos
  FOR EACH ROW EXECUTE FUNCTION registrar_consumo_de_fase_tacho();

DROP TRIGGER trg_tachos_validar_densidad ON tachos;
CREATE TRIGGER trg_tachos_validar_densidad
  BEFORE INSERT ON tachos
  FOR EACH ROW EXECUTE FUNCTION validar_densidad_al_fraccionar();

DROP TRIGGER trg_cajas_impedir_reabrir ON cajas;
DROP FUNCTION impedir_reabrir_caja();

DROP TRIGGER trg_ventas_validar_anulacion ON ventas;
DROP FUNCTION validar_anulacion_de_venta();

DROP TRIGGER trg_pagos_venta_congelar ON pagos_venta;
DROP TRIGGER trg_venta_tachos_congelar ON venta_tachos;
DROP TRIGGER trg_venta_detalle_congelar ON venta_detalle;
DROP FUNCTION congelar_lineas_de_venta();
