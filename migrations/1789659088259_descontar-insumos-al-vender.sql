-- Up Migration

ALTER TABLE movimientos_insumo
  ADD COLUMN id_venta INTEGER REFERENCES ventas (id_venta) ON DELETE RESTRICT;

CREATE INDEX movimientos_insumo_id_venta_idx ON movimientos_insumo (id_venta);

ALTER TABLE movimientos_insumo
  DROP CONSTRAINT movimientos_insumo_tipo_check;

ALTER TABLE movimientos_insumo
  ADD CONSTRAINT movimientos_insumo_tipo_check
  CHECK (tipo_movimiento IN ('ENTRADA_COMPRA', 'CONSUMO_PRODUCCION', 'CONSUMO_VENTA', 'AJUSTE'));

ALTER TABLE movimientos_insumo
  DROP CONSTRAINT movimientos_insumo_signo_check;

ALTER TABLE movimientos_insumo
  ADD CONSTRAINT movimientos_insumo_signo_check
  CHECK (
    (tipo_movimiento = 'ENTRADA_COMPRA' AND cantidad > 0)
    OR (tipo_movimiento IN ('CONSUMO_PRODUCCION', 'CONSUMO_VENTA') AND cantidad < 0)
    OR tipo_movimiento = 'AJUSTE'
  );

ALTER TABLE movimientos_insumo
  ADD CONSTRAINT movimientos_insumo_venta_coherente_check
  CHECK ((tipo_movimiento = 'CONSUMO_VENTA') = (id_venta IS NOT NULL));

-- Descuenta los insumos que gasta el producto al venderse, en la sucursal de la
-- caja. Lo hace la base y no la aplicacion por el mismo motivo que en los
-- traslados: si dependiera de la pantalla, una pantalla que se olvide deja el
-- stock inflado y los duenos encargan tarde, que es justo lo que este control
-- vino a evitar.
CREATE FUNCTION registrar_consumo_venta_insumos()
RETURNS TRIGGER AS $$
DECLARE
  v_sucursal INTEGER;
  v_usuario  INTEGER;
  v_fecha    TIMESTAMPTZ;
  v_fila     RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM producto_insumos WHERE id_producto = NEW.id_producto) THEN
    RETURN NEW;
  END IF;

  SELECT c.id_sucursal, v.id_usuario, v.fecha_hora
    INTO v_sucursal, v_usuario, v_fecha
    FROM ventas v
    LEFT JOIN cajas c ON c.id_caja = v.id_caja
   WHERE v.id_venta = NEW.id_venta;

  IF v_sucursal IS NULL THEN
    RAISE EXCEPTION 'La venta % no tiene caja, asi que no se sabe de que sucursal descontar los insumos del producto %', NEW.id_venta, NEW.id_producto;
  END IF;

  FOR v_fila IN
    SELECT pi.id_insumo,
           pi.cantidad,
           up.factor_a_base AS factor_producto,
           up.magnitud      AS magnitud_producto,
           ui.factor_a_base AS factor_insumo,
           ui.magnitud      AS magnitud_insumo
      FROM producto_insumos pi
      JOIN unidades_medida up ON up.id_unidad = pi.id_unidad_medida
      JOIN insumos i         ON i.id_insumo   = pi.id_insumo
      JOIN unidades_medida ui ON ui.id_unidad = i.id_unidad_medida
     WHERE pi.id_producto = NEW.id_producto
  LOOP
    IF v_fila.magnitud_producto <> v_fila.magnitud_insumo THEN
      RAISE EXCEPTION 'El insumo % se compra en % y el producto lo mide en %: no hay forma de convertir entre magnitudes distintas',
        v_fila.id_insumo, v_fila.magnitud_insumo, v_fila.magnitud_producto;
    END IF;

    -- Se pasa a la unidad de compra del insumo, que es en la que movimientos_insumo
    -- guarda todo: la salsa se compra por kilo aunque se sirva de a gramos.
    INSERT INTO movimientos_insumo
      (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_venta, id_usuario, fecha_hora)
    VALUES (
      v_fila.id_insumo,
      v_sucursal,
      'CONSUMO_VENTA',
      -(NEW.cantidad * v_fila.cantidad * v_fila.factor_producto / v_fila.factor_insumo),
      NEW.id_venta,
      v_usuario,
      v_fecha
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_venta_detalle_descontar_insumos
  AFTER INSERT ON venta_detalle
  FOR EACH ROW
  EXECUTE FUNCTION registrar_consumo_venta_insumos();

COMMENT ON COLUMN movimientos_insumo.id_venta IS
  'Venta que causó el consumo. Obligatorio en los CONSUMO_VENTA y nulo en el resto.';
COMMENT ON COLUMN movimientos_insumo.tipo_movimiento IS
  'Los insumos entran por compra y salen de dos formas: consumidos al fabricar (CONSUMO_PRODUCCION, contra una producción) o gastados al vender (CONSUMO_VENTA, como el cono de un cucurucho o el envase de un térmico). AJUSTE corrige diferencias de recuento. No se trasladan entre sucursales, porque cada una le compra a sus proveedores.';
COMMENT ON FUNCTION registrar_consumo_venta_insumos() IS
  'Descuenta los insumos de producto_insumos al vender, convirtiendo a la unidad de compra del insumo. Un producto sin insumos asociados no genera nada.';

-- Down Migration

DROP TRIGGER trg_venta_detalle_descontar_insumos ON venta_detalle;
DROP FUNCTION registrar_consumo_venta_insumos();

ALTER TABLE movimientos_insumo
  DROP CONSTRAINT movimientos_insumo_venta_coherente_check;

ALTER TABLE movimientos_insumo
  DROP CONSTRAINT movimientos_insumo_signo_check;

ALTER TABLE movimientos_insumo
  ADD CONSTRAINT movimientos_insumo_signo_check
  CHECK (
    (tipo_movimiento = 'ENTRADA_COMPRA' AND cantidad > 0)
    OR (tipo_movimiento = 'CONSUMO_PRODUCCION' AND cantidad < 0)
    OR tipo_movimiento = 'AJUSTE'
  );

-- Falla a proposito si ya hay consumos por venta registrados: habria que
-- decidir que hacer con ellos antes de sacar el tipo del CHECK.
ALTER TABLE movimientos_insumo
  DROP CONSTRAINT movimientos_insumo_tipo_check;

ALTER TABLE movimientos_insumo
  ADD CONSTRAINT movimientos_insumo_tipo_check
  CHECK (tipo_movimiento IN ('ENTRADA_COMPRA', 'CONSUMO_PRODUCCION', 'AJUSTE'));

DROP INDEX movimientos_insumo_id_venta_idx;

ALTER TABLE movimientos_insumo
  DROP COLUMN id_venta;

COMMENT ON COLUMN movimientos_insumo.tipo_movimiento IS
  'Los insumos solo entran por compra, se consumen en producción o se ajustan. No se venden ni se trasladan entre sucursales, porque cada sucursal le compra lo suyo a sus proveedores.';
