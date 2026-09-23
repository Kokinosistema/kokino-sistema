-- Up Migration

-- Cuando se creo ventas no llevaba sucursal, porque se podia deducir de la
-- caja y toda venta tenia caja. Despues la caja paso a ser opcional para las
-- ventas mayoristas, y en ese momento la sucursal dejo de ser deducible sin
-- que nada avisara: los triggers de stock siguieron buscandola por la caja y
-- encontraron NULL, asi que cargar cualquier producto en una venta mayorista
-- fallaba con un error de PostgreSQL.
--
-- La leccion queda escrita aca: un dato derivado solo es seguro mientras su
-- origen este garantizado. Al volverse opcional el origen, el derivado tiene
-- que pasar a guardarse.
ALTER TABLE ventas ADD COLUMN id_sucursal INTEGER REFERENCES sucursales (id_sucursal) ON DELETE RESTRICT;

-- Las ventas que ya existan toman la sucursal de su caja; las mayoristas, que
-- no tienen caja, la toman de los tachos que se llevaron, que si saben donde
-- estaban. Si no hubiera ni una cosa ni la otra, queda la sucursal con
-- fabrica, que es donde se despacha al mayorista.
UPDATE ventas v SET id_sucursal = COALESCE(
  (SELECT c.id_sucursal FROM cajas c WHERE c.id_caja = v.id_caja),
  (SELECT t.id_sucursal FROM venta_tachos vt JOIN tachos t ON t.id_tacho = vt.id_tacho
    WHERE vt.id_venta = v.id_venta LIMIT 1),
  (SELECT s.id_sucursal FROM sucursales s WHERE s.tiene_fabrica LIMIT 1)
) WHERE v.id_sucursal IS NULL;

ALTER TABLE ventas ALTER COLUMN id_sucursal SET NOT NULL;

CREATE INDEX ventas_id_sucursal_idx ON ventas (id_sucursal);

-- Cuando la venta si tiene caja, su sucursal tiene que ser la de esa caja. La
-- FK compuesta lo garantiza sin estorbar a las mayoristas: PostgreSQL no
-- valida una clave foranea si alguna de sus columnas es nula, asi que una
-- venta sin caja simplemente no pasa por este control.
ALTER TABLE cajas ADD CONSTRAINT cajas_id_sucursal_key UNIQUE (id_caja, id_sucursal);
ALTER TABLE ventas ADD CONSTRAINT ventas_caja_misma_sucursal_fkey
  FOREIGN KEY (id_caja, id_sucursal) REFERENCES cajas (id_caja, id_sucursal) ON DELETE RESTRICT;

COMMENT ON COLUMN ventas.id_sucursal IS
  'Sucursal donde se hizo la venta. Se guarda en vez de deducirse de la caja porque las ventas mayoristas no tienen caja, y sin este dato no se sabria de donde descontar el stock. Cuando hay caja, una FK compuesta obliga a que coincida con la de la caja.';

-- Los dos triggers de stock leen ahora la sucursal de la venta. Se cae el
-- RAISE EXCEPTION que frenaba las ventas mayoristas: ya no hay caso en que la
-- sucursal falte.
CREATE OR REPLACE FUNCTION registrar_salida_venta_producto()
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

  SELECT v.id_sucursal, v.id_usuario, v.fecha_hora
    INTO v_sucursal, v_usuario, v_fecha
    FROM ventas v WHERE v.id_venta = NEW.id_venta;

  INSERT INTO movimientos_producto
    (id_producto, id_sucursal, tipo_movimiento, cantidad, id_venta, id_usuario, fecha_hora)
  VALUES
    (NEW.id_producto, v_sucursal, 'SALIDA_VENTA', -NEW.cantidad, NEW.id_venta, v_usuario, v_fecha);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION registrar_consumo_venta_insumos()
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

  SELECT v.id_sucursal, v.id_usuario, v.fecha_hora
    INTO v_sucursal, v_usuario, v_fecha
    FROM ventas v WHERE v.id_venta = NEW.id_venta;

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

-- Down Migration

-- Los triggers vuelven a buscar la sucursal por la caja antes de que la
-- columna desaparezca. Si se los dejara como estan, quedarian leyendo una
-- columna inexistente y el error recien saltaria al vender.
CREATE OR REPLACE FUNCTION registrar_salida_venta_producto()
RETURNS TRIGGER AS $$
DECLARE
  v_lleva_stock BOOLEAN;
  v_sucursal    INTEGER;
  v_usuario     INTEGER;
  v_fecha       TIMESTAMPTZ;
BEGIN
  SELECT lleva_stock_propio INTO v_lleva_stock
    FROM productos WHERE id_producto = NEW.id_producto;

  IF NOT v_lleva_stock THEN
    RETURN NEW;
  END IF;

  SELECT c.id_sucursal, v.id_usuario, v.fecha_hora
    INTO v_sucursal, v_usuario, v_fecha
    FROM ventas v
    LEFT JOIN cajas c ON c.id_caja = v.id_caja
   WHERE v.id_venta = NEW.id_venta;

  IF v_sucursal IS NULL THEN
    RAISE EXCEPTION 'La venta % no tiene caja, asi que no se sabe de que sucursal descontar el producto %', NEW.id_venta, NEW.id_producto;
  END IF;

  INSERT INTO movimientos_producto
    (id_producto, id_sucursal, tipo_movimiento, cantidad, id_venta, id_usuario, fecha_hora)
  VALUES
    (NEW.id_producto, v_sucursal, 'SALIDA_VENTA', -NEW.cantidad, NEW.id_venta, v_usuario, v_fecha);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION registrar_consumo_venta_insumos()
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
    SELECT pi.id_insumo, pi.cantidad,
           up.factor_a_base AS factor_producto, up.magnitud AS magnitud_producto,
           ui.factor_a_base AS factor_insumo,   ui.magnitud AS magnitud_insumo
      FROM producto_insumos pi
      JOIN unidades_medida up ON up.id_unidad = pi.id_unidad_medida
      JOIN insumos i          ON i.id_insumo   = pi.id_insumo
      JOIN unidades_medida ui ON ui.id_unidad = i.id_unidad_medida
     WHERE pi.id_producto = NEW.id_producto
  LOOP
    IF v_fila.magnitud_producto <> v_fila.magnitud_insumo THEN
      RAISE EXCEPTION 'El insumo % se compra en % y el producto lo mide en %: no hay forma de convertir entre magnitudes distintas',
        v_fila.id_insumo, v_fila.magnitud_insumo, v_fila.magnitud_producto;
    END IF;

    INSERT INTO movimientos_insumo
      (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_venta, id_usuario, fecha_hora)
    VALUES (
      v_fila.id_insumo, v_sucursal, 'CONSUMO_VENTA',
      -(NEW.cantidad * v_fila.cantidad * v_fila.factor_producto / v_fila.factor_insumo),
      NEW.id_venta, v_usuario, v_fecha
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE ventas DROP CONSTRAINT ventas_caja_misma_sucursal_fkey;
ALTER TABLE cajas DROP CONSTRAINT cajas_id_sucursal_key;
ALTER TABLE ventas DROP COLUMN id_sucursal;
