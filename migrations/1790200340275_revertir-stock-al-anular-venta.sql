-- Up Migration

-- Anular una venta no devolvia nada al stock. Los triggers que descuentan son
-- todos AFTER INSERT sobre el detalle, y nadie escuchaba el UPDATE que marca
-- la anulacion: la venta quedaba anulada y el stock descontado para siempre.
-- Con los tachos era peor todavia, porque quedaban en ENTREGADO_MAYORISTA y
-- el trigger de entrega exige LLENO, asi que ese tacho no se podia vender
-- nunca mas: se perdia del inventario por una anulacion.
--
-- La devolucion se registra como un movimiento nuevo en lugar de borrar el
-- original, para que quede el rastro de que hubo venta y despues anulacion.
-- Lleva tipo propio, ANULACION_VENTA, asi los reportes pueden separar cuanto
-- stock volvio por anulaciones de lo que volvio por roturas o recuentos.
ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_tipo_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_tipo_check
  CHECK (tipo_movimiento IN (
    'ENTRADA_COMPRA', 'CONSUMO_PRODUCCION', 'CONSUMO_VENTA',
    'ANULACION_VENTA', 'AJUSTE', 'RECUENTO'
  ));

ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_signo_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_signo_check
  CHECK (
    (tipo_movimiento IN ('ENTRADA_COMPRA', 'ANULACION_VENTA') AND cantidad > 0)
    OR (tipo_movimiento IN ('CONSUMO_PRODUCCION', 'CONSUMO_VENTA') AND cantidad < 0)
    OR tipo_movimiento IN ('AJUSTE', 'RECUENTO')
  );

-- La devolucion tambien apunta a la venta que se anulo, asi que el tipo nuevo
-- entra en la regla que ata id_venta a los movimientos de venta.
ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_venta_coherente_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_venta_coherente_check
  CHECK ((tipo_movimiento IN ('CONSUMO_VENTA', 'ANULACION_VENTA')) = (id_venta IS NOT NULL));

ALTER TABLE movimientos_producto DROP CONSTRAINT movimientos_producto_tipo_check;
ALTER TABLE movimientos_producto ADD CONSTRAINT movimientos_producto_tipo_check
  CHECK (tipo_movimiento IN (
    'ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'SALIDA_VENTA', 'ANULACION_VENTA',
    'ENTRADA_TRASLADO', 'SALIDA_TRASLADO', 'AJUSTE', 'RECUENTO'
  ));

ALTER TABLE movimientos_producto DROP CONSTRAINT movimientos_producto_signo_check;
ALTER TABLE movimientos_producto ADD CONSTRAINT movimientos_producto_signo_check
  CHECK (
    (tipo_movimiento IN ('ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'ENTRADA_TRASLADO', 'ANULACION_VENTA') AND cantidad > 0)
    OR (tipo_movimiento IN ('SALIDA_VENTA', 'SALIDA_TRASLADO') AND cantidad < 0)
    OR tipo_movimiento IN ('AJUSTE', 'RECUENTO')
  );

ALTER TABLE movimientos_producto DROP CONSTRAINT movimientos_producto_venta_coherente_check;
ALTER TABLE movimientos_producto ADD CONSTRAINT movimientos_producto_venta_coherente_check
  CHECK ((tipo_movimiento IN ('SALIDA_VENTA', 'ANULACION_VENTA')) = (id_venta IS NOT NULL));

CREATE FUNCTION revertir_stock_al_anular_venta()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO movimientos_producto
    (id_producto, id_sucursal, tipo_movimiento, cantidad, id_venta, id_usuario, fecha_hora)
  SELECT m.id_producto, m.id_sucursal, 'ANULACION_VENTA', -m.cantidad,
         m.id_venta, NEW.id_usuario_anulacion, NEW.fecha_anulacion
    FROM movimientos_producto m
   WHERE m.id_venta = NEW.id_venta AND m.tipo_movimiento = 'SALIDA_VENTA';

  INSERT INTO movimientos_insumo
    (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_venta, id_usuario, fecha_hora)
  SELECT m.id_insumo, m.id_sucursal, 'ANULACION_VENTA', -m.cantidad,
         m.id_venta, NEW.id_usuario_anulacion, NEW.fecha_anulacion
    FROM movimientos_insumo m
   WHERE m.id_venta = NEW.id_venta AND m.tipo_movimiento = 'CONSUMO_VENTA';

  -- El tacho entregado al mayorista vuelve al freezer lleno, que es el estado
  -- que tenia antes de entregarse y el unico desde el que se lo puede volver
  -- a vender.
  UPDATE tachos SET estado = 'LLENO'
   WHERE estado = 'ENTREGADO_MAYORISTA'
     AND id_tacho IN (SELECT id_tacho FROM venta_tachos WHERE id_venta = NEW.id_venta);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Solo al pasar de no anulada a anulada. Sin esa condicion, cualquier UPDATE
-- posterior sobre una venta ya anulada volveria a devolver el stock.
CREATE TRIGGER trg_ventas_revertir_stock_al_anular
  AFTER UPDATE ON ventas
  FOR EACH ROW
  WHEN (OLD.fecha_anulacion IS NULL AND NEW.fecha_anulacion IS NOT NULL)
  EXECUTE FUNCTION revertir_stock_al_anular_venta();

COMMENT ON FUNCTION revertir_stock_al_anular_venta() IS
  'Al anular una venta devuelve al stock lo que la venta habia descontado y libera los tachos entregados al mayorista. Los movimientos originales no se tocan: se compensan con uno nuevo, para que el historial muestre la venta y su anulacion.';

-- Down Migration

DROP TRIGGER trg_ventas_revertir_stock_al_anular ON ventas;
DROP FUNCTION revertir_stock_al_anular_venta();

-- Falla a proposito si ya se registraron anulaciones: sacar el tipo dejaria
-- esos movimientos invalidos, y que hacer con ellos hay que decidirlo antes.
ALTER TABLE movimientos_producto DROP CONSTRAINT movimientos_producto_venta_coherente_check;
ALTER TABLE movimientos_producto ADD CONSTRAINT movimientos_producto_venta_coherente_check
  CHECK ((tipo_movimiento = 'SALIDA_VENTA') = (id_venta IS NOT NULL));

ALTER TABLE movimientos_producto DROP CONSTRAINT movimientos_producto_signo_check;
ALTER TABLE movimientos_producto ADD CONSTRAINT movimientos_producto_signo_check
  CHECK (
    (tipo_movimiento IN ('ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'ENTRADA_TRASLADO') AND cantidad > 0)
    OR (tipo_movimiento IN ('SALIDA_VENTA', 'SALIDA_TRASLADO') AND cantidad < 0)
    OR tipo_movimiento IN ('AJUSTE', 'RECUENTO')
  );

ALTER TABLE movimientos_producto DROP CONSTRAINT movimientos_producto_tipo_check;
ALTER TABLE movimientos_producto ADD CONSTRAINT movimientos_producto_tipo_check
  CHECK (tipo_movimiento IN (
    'ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'SALIDA_VENTA',
    'ENTRADA_TRASLADO', 'SALIDA_TRASLADO', 'AJUSTE', 'RECUENTO'
  ));

ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_venta_coherente_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_venta_coherente_check
  CHECK ((tipo_movimiento = 'CONSUMO_VENTA') = (id_venta IS NOT NULL));

ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_signo_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_signo_check
  CHECK (
    (tipo_movimiento = 'ENTRADA_COMPRA' AND cantidad > 0)
    OR (tipo_movimiento IN ('CONSUMO_PRODUCCION', 'CONSUMO_VENTA') AND cantidad < 0)
    OR tipo_movimiento IN ('AJUSTE', 'RECUENTO')
  );

ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_tipo_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_tipo_check
  CHECK (tipo_movimiento IN (
    'ENTRADA_COMPRA', 'CONSUMO_PRODUCCION', 'CONSUMO_VENTA', 'AJUSTE', 'RECUENTO'
  ));
