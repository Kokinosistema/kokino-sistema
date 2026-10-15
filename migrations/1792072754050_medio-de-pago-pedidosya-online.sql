-- Up Migration

-- Medio de pago "PedidosYa (online)" (pedido de la usuaria el 2026-10-15).
-- Los pedidos de PedidosYa se pagan a veces en la app y a veces al
-- repartidor. Lo pagado en la app no entra al cajon ni es una transferencia
-- al negocio: lo liquida PedidosYa dias despues. Si se cargara como
-- "Transferencia o QR", el resumen de la caja no coincidiria con el banco.
-- Lo pagado al repartidor se sigue cargando con Efectivo o QR, como siempre.
--
-- Ese medio solo tiene sentido en una venta de PedidosYa. Para eso, cada
-- medio puede quedar atado a un canal (solo_canal), y la base rechaza un
-- pago de otro canal con el, y cualquier salida de caja: nadie paga un gasto
-- "con PedidosYa".

ALTER TABLE medios_pago
  ADD COLUMN solo_canal VARCHAR(20),
  ADD CONSTRAINT medios_pago_solo_canal_check
    CHECK (solo_canal IN ('MOSTRADOR', 'TELEFONO', 'PEDIDOSYA', 'MAYORISTA'));

COMMENT ON COLUMN medios_pago.solo_canal IS
  'Si tiene valor, el medio solo se puede usar en ventas de ese canal, y nunca en salidas de caja. Nulo para los medios de siempre, que sirven en cualquier canal.';

INSERT INTO medios_pago (nombre, afecta_caja_efectivo, solo_canal)
VALUES ('PedidosYa (online)', false, 'PEDIDOSYA');

CREATE FUNCTION validar_canal_del_medio_de_pago() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_solo_canal VARCHAR(20);
  v_nombre     VARCHAR(50);
  v_canal      VARCHAR(20);
BEGIN
  SELECT solo_canal, nombre INTO v_solo_canal, v_nombre
    FROM medios_pago WHERE id_medio_pago = NEW.id_medio_pago;
  IF v_solo_canal IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'egresos' THEN
    RAISE EXCEPTION 'Una salida de caja no se paga con %: ese medio es solo para ventas de %', v_nombre, v_solo_canal;
  END IF;
  SELECT canal_venta INTO v_canal FROM ventas WHERE id_venta = NEW.id_venta;
  IF v_canal IS DISTINCT FROM v_solo_canal THEN
    RAISE EXCEPTION 'La venta % es de %, y % es solo para ventas de %', NEW.id_venta, v_canal, v_nombre, v_solo_canal;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pagos_venta_canal_del_medio
  BEFORE INSERT OR UPDATE OF id_medio_pago ON pagos_venta
  FOR EACH ROW EXECUTE FUNCTION validar_canal_del_medio_de_pago();

CREATE TRIGGER trg_egresos_canal_del_medio
  BEFORE INSERT OR UPDATE OF id_medio_pago ON egresos
  FOR EACH ROW EXECUTE FUNCTION validar_canal_del_medio_de_pago();

-- Down Migration

DROP TRIGGER trg_egresos_canal_del_medio ON egresos;
DROP TRIGGER trg_pagos_venta_canal_del_medio ON pagos_venta;
DROP FUNCTION validar_canal_del_medio_de_pago();

-- Si ya hay pagos con este medio, el borrado falla (la clave foranea de
-- pagos_venta lo impide) y la migracion no se revierte: es lo correcto,
-- porque esas ventas perderian como se cobraron.
DELETE FROM medios_pago WHERE nombre = 'PedidosYa (online)';

ALTER TABLE medios_pago DROP COLUMN solo_canal;
