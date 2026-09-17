-- Up Migration

-- El tipo SALIDA_VENTA existia desde que se creo el libro de movimientos, pero
-- nada lo generaba y no habia forma de saber que venta lo habia causado: el
-- modulo de stock se construyo antes que el de ventas y el cabo quedo suelto.
ALTER TABLE movimientos_producto
  ADD COLUMN id_venta INTEGER REFERENCES ventas (id_venta) ON DELETE RESTRICT;

CREATE INDEX movimientos_producto_id_venta_idx ON movimientos_producto (id_venta);

ALTER TABLE movimientos_producto
  ADD CONSTRAINT movimientos_producto_venta_coherente_check
  CHECK ((tipo_movimiento = 'SALIDA_VENTA') = (id_venta IS NOT NULL));

-- Descuenta el stock al cargar la linea de venta, igual que hacen los traslados,
-- en vez de confiar en que la aplicacion se acuerde. Si no lo hiciera la base,
-- una venta cargada por una pantalla que se olvide del movimiento dejaria el
-- stock inflado y nadie se enteraria hasta el proximo recuento fisico.
CREATE FUNCTION registrar_salida_venta_producto()
RETURNS TRIGGER AS $$
DECLARE
  v_lleva_stock BOOLEAN;
  v_sucursal    INTEGER;
  v_usuario     INTEGER;
  v_fecha       TIMESTAMPTZ;
BEGIN
  SELECT lleva_stock_propio INTO v_lleva_stock
    FROM productos WHERE id_producto = NEW.id_producto;

  -- El helado que se arma al momento, como el termico, ya lo cuenta la tabla
  -- tachos: descontarlo tambien aca seria contar el mismo helado dos veces.
  IF NOT v_lleva_stock THEN
    RETURN NEW;
  END IF;

  SELECT c.id_sucursal, v.id_usuario, v.fecha_hora
    INTO v_sucursal, v_usuario, v_fecha
    FROM ventas v
    LEFT JOIN cajas c ON c.id_caja = v.id_caja
   WHERE v.id_venta = NEW.id_venta;

  IF v_sucursal IS NULL THEN
    RAISE EXCEPTION 'La venta % no tiene caja, asi que no se sabe de que sucursal descontar el producto %. El mayorista se lleva tachos enteros y esos van en venta_tachos', NEW.id_venta, NEW.id_producto;
  END IF;

  INSERT INTO movimientos_producto
    (id_producto, id_sucursal, tipo_movimiento, cantidad, id_venta, id_usuario, fecha_hora)
  VALUES
    (NEW.id_producto, v_sucursal, 'SALIDA_VENTA', -NEW.cantidad, NEW.id_venta, v_usuario, v_fecha);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_venta_detalle_descontar_stock
  AFTER INSERT ON venta_detalle
  FOR EACH ROW
  EXECUTE FUNCTION registrar_salida_venta_producto();

COMMENT ON COLUMN movimientos_producto.id_venta IS
  'Venta que causó la salida. Obligatorio en los SALIDA_VENTA y nulo en el resto, para poder reconstruir de dónde salió cada unidad que falta.';
COMMENT ON COLUMN movimientos_producto.tipo_movimiento IS
  'A diferencia de los insumos, los productos además se venden y viajan entre sucursales. Las salidas por venta las genera un trigger sobre venta_detalle, así el stock no depende de que la aplicación se acuerde de registrarlas.';
COMMENT ON FUNCTION registrar_salida_venta_producto() IS
  'Descuenta del stock de la sucursal de la caja lo vendido en cada línea de venta. Ignora los productos sin stock propio, como los térmicos, porque su helado ya lo cuentan los tachos.';

-- Down Migration

DROP TRIGGER trg_venta_detalle_descontar_stock ON venta_detalle;
DROP FUNCTION registrar_salida_venta_producto();

ALTER TABLE movimientos_producto
  DROP CONSTRAINT movimientos_producto_venta_coherente_check;

DROP INDEX movimientos_producto_id_venta_idx;

-- Ojo: DROP COLUMN no falla aunque haya datos, los borra en silencio. Si ya hay
-- salidas por venta registradas, revertir pierde para siempre que venta causo
-- cada una. Los movimientos quedan, pero huerfanos de explicacion.
ALTER TABLE movimientos_producto
  DROP COLUMN id_venta;

COMMENT ON COLUMN movimientos_producto.tipo_movimiento IS
  'A diferencia de los insumos, los productos además se venden y viajan entre sucursales. SALIDA_VENTA todavía no tiene una FK a la venta porque el módulo de ventas aún no existe: se agrega cuando se cree.';
