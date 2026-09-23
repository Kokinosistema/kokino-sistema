-- Up Migration

-- Paquete, Botella y Unidad son las tres de magnitud CONTEO y las tres tienen
-- factor 1, asi que los triggers las convertian entre si sin chistar: cargar
-- que un bombon lleva "1 unidad de Oreo", cuando la Oreo se compra por
-- paquete, descontaba un paquete entero por bombon vendido.
--
-- El factor 1 en las unidades de conteo era una afirmacion falsa: decir que un
-- paquete vale lo mismo que una unidad supone que son equivalentes, y cuantas
-- unidades trae un paquete depende del producto. No hay factor universal.
--
-- La regla queda en una sola funcion que usan los tres triggers que convierten,
-- en lugar de repetida tres veces. Estaba escrita en un comentario y en ningun
-- lado del codigo, que es la peor combinacion: parece resuelto y no lo esta.
CREATE FUNCTION convertir_a_unidad_de_compra(
  p_cantidad        NUMERIC,
  p_unidad_receta   INTEGER,
  p_unidad_compra   INTEGER,
  p_que             TEXT
) RETURNS NUMERIC AS $$
DECLARE
  r RECORD;
  c RECORD;
BEGIN
  SELECT nombre, magnitud, factor_a_base INTO r FROM unidades_medida WHERE id_unidad = p_unidad_receta;
  SELECT nombre, magnitud, factor_a_base INTO c FROM unidades_medida WHERE id_unidad = p_unidad_compra;

  IF r.magnitud <> c.magnitud THEN
    RAISE EXCEPTION '% se compra en % y se pide en %: no hay forma de convertir entre magnitudes distintas',
      p_que, c.nombre, r.nombre;
  END IF;

  -- Dentro de CONTEO solo vale la misma unidad. Un paquete no equivale a una
  -- unidad ni a una botella: para saber cuantas unidades trae un paquete hay
  -- que saber de que producto se habla, y eso no es un dato de la unidad.
  IF r.magnitud = 'CONTEO' AND p_unidad_receta <> p_unidad_compra THEN
    RAISE EXCEPTION '% se compra por % y se pide por %: son dos formas de contar distintas y no hay equivalencia entre ellas. Cargalo en % o dividi el insumo en dos',
      p_que, c.nombre, r.nombre, c.nombre;
  END IF;

  RETURN p_cantidad * r.factor_a_base / c.factor_a_base;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION convertir_a_unidad_de_compra(NUMERIC, INTEGER, INTEGER, TEXT) IS
  'Pasa una cantidad de la unidad en que la expresa una receta a la unidad en que se compra el insumo. Rechaza convertir entre magnitudes distintas, y dentro de CONTEO exige la misma unidad, porque un paquete no equivale a una unidad.';

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
    SELECT pi.id_insumo, pi.cantidad, pi.id_unidad_medida AS unidad_receta,
           i.id_unidad_medida AS unidad_compra, i.nombre
      FROM producto_insumos pi
      JOIN insumos i ON i.id_insumo = pi.id_insumo
     WHERE pi.id_producto = NEW.id_producto
  LOOP
    INSERT INTO movimientos_insumo
      (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_venta, id_usuario, fecha_hora)
    VALUES (
      v_fila.id_insumo, v_sucursal, 'CONSUMO_VENTA',
      -convertir_a_unidad_de_compra(NEW.cantidad * v_fila.cantidad,
                                    v_fila.unidad_receta, v_fila.unidad_compra,
                                    'El insumo '||v_fila.nombre),
      NEW.id_venta, v_usuario, v_fecha
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION registrar_movimientos_de_produccion()
RETURNS TRIGGER AS $$
DECLARE
  v_producto INTEGER;
  v_rinde    NUMERIC;
  v_factor   NUMERIC;
  v_fila     RECORD;
BEGIN
  SELECT r.id_producto_resultado, r.cantidad_rendimiento
    INTO v_producto, v_rinde
    FROM recetas r WHERE r.id_receta = NEW.id_receta;

  v_factor := NEW.cantidad_teorica / v_rinde;

  FOR v_fila IN
    SELECT rd.id_insumo, rd.cantidad_necesaria AS cantidad,
           rd.id_unidad_medida AS unidad_receta,
           i.id_unidad_medida  AS unidad_compra, i.nombre
      FROM receta_detalle rd
      JOIN insumos i ON i.id_insumo = rd.id_insumo
     WHERE rd.id_receta = NEW.id_receta AND rd.fase = 'TINA'
  LOOP
    INSERT INTO movimientos_insumo
      (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (
      v_fila.id_insumo, NEW.id_sucursal, 'CONSUMO_PRODUCCION',
      -convertir_a_unidad_de_compra(v_fila.cantidad * v_factor,
                                    v_fila.unidad_receta, v_fila.unidad_compra,
                                    'El insumo '||v_fila.nombre),
      NEW.id_produccion, NEW.id_usuario_responsable, NEW.fecha_produccion
    );
  END LOOP;

  IF v_producto IS NOT NULL THEN
    INSERT INTO movimientos_producto
      (id_producto, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (v_producto, NEW.id_sucursal, 'ALTA_PRODUCCION', NEW.cantidad_real,
            NEW.id_produccion, NEW.id_usuario_responsable, NEW.fecha_produccion);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION registrar_consumo_de_fase_tacho()
RETURNS TRIGGER AS $$
DECLARE
  v_prod RECORD;
  v_fila RECORD;
BEGIN
  IF NEW.id_lote IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.id_produccion, p.id_receta, p.id_usuario_responsable
    INTO v_prod
    FROM lotes l JOIN produccion p ON p.id_produccion = l.id_produccion
   WHERE l.id_lote = NEW.id_lote;

  FOR v_fila IN
    SELECT rd.id_insumo, rd.cantidad_necesaria AS cantidad,
           rd.id_unidad_medida AS unidad_receta,
           i.id_unidad_medida  AS unidad_compra, i.nombre
      FROM receta_detalle rd
      JOIN insumos i ON i.id_insumo = rd.id_insumo
     WHERE rd.id_receta = v_prod.id_receta AND rd.fase = 'TACHO'
  LOOP
    INSERT INTO movimientos_insumo
      (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (
      v_fila.id_insumo, NEW.id_sucursal, 'CONSUMO_PRODUCCION',
      -convertir_a_unidad_de_compra(v_fila.cantidad,
                                    v_fila.unidad_receta, v_fila.unidad_compra,
                                    'El insumo '||v_fila.nombre),
      v_prod.id_produccion, v_prod.id_usuario_responsable, now()
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- proveedores.cuit usaba un indice unico parcial y clientes.cuit un UNIQUE
-- comun, que en PostgreSQL hacen lo mismo porque los nulos nunca chocan entre
-- si. Dos formas de escribir la misma regla en tablas hermanas. Queda la
-- simple, que es la que ya usa clientes.
DROP INDEX proveedores_cuit_uidx;
ALTER TABLE proveedores ADD CONSTRAINT proveedores_cuit_key UNIQUE (cuit);

-- Down Migration

ALTER TABLE proveedores DROP CONSTRAINT proveedores_cuit_key;
CREATE UNIQUE INDEX proveedores_cuit_uidx ON proveedores (cuit) WHERE cuit IS NOT NULL;

-- Los tres triggers vuelven a convertir por su cuenta antes de que la funcion
-- desaparezca. Si se los dejara como estan, quedarian llamando a algo que ya
-- no existe y el error saltaria recien al vender o al producir.
CREATE OR REPLACE FUNCTION registrar_consumo_venta_insumos()
RETURNS TRIGGER AS $f$
DECLARE
  v_sucursal INTEGER; v_usuario INTEGER; v_fecha TIMESTAMPTZ; v_fila RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM producto_insumos WHERE id_producto = NEW.id_producto) THEN
    RETURN NEW;
  END IF;
  SELECT v.id_sucursal, v.id_usuario, v.fecha_hora INTO v_sucursal, v_usuario, v_fecha
    FROM ventas v WHERE v.id_venta = NEW.id_venta;
  FOR v_fila IN
    SELECT pi.id_insumo, pi.cantidad,
           up.factor_a_base AS factor_producto, up.magnitud AS magnitud_producto,
           ui.factor_a_base AS factor_insumo,   ui.magnitud AS magnitud_insumo
      FROM producto_insumos pi
      JOIN unidades_medida up ON up.id_unidad = pi.id_unidad_medida
      JOIN insumos i          ON i.id_insumo  = pi.id_insumo
      JOIN unidades_medida ui ON ui.id_unidad = i.id_unidad_medida
     WHERE pi.id_producto = NEW.id_producto
  LOOP
    IF v_fila.magnitud_producto <> v_fila.magnitud_insumo THEN
      RAISE EXCEPTION 'El insumo % se compra en % y el producto lo mide en %: no hay forma de convertir entre magnitudes distintas',
        v_fila.id_insumo, v_fila.magnitud_insumo, v_fila.magnitud_producto;
    END IF;
    INSERT INTO movimientos_insumo
      (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_venta, id_usuario, fecha_hora)
    VALUES (v_fila.id_insumo, v_sucursal, 'CONSUMO_VENTA',
      -(NEW.cantidad * v_fila.cantidad * v_fila.factor_producto / v_fila.factor_insumo),
      NEW.id_venta, v_usuario, v_fecha);
  END LOOP;
  RETURN NEW;
END;
$f$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION registrar_movimientos_de_produccion()
RETURNS TRIGGER AS $f$
DECLARE
  v_producto INTEGER; v_rinde NUMERIC; v_factor NUMERIC; v_fila RECORD;
BEGIN
  SELECT r.id_producto_resultado, r.cantidad_rendimiento INTO v_producto, v_rinde
    FROM recetas r WHERE r.id_receta = NEW.id_receta;
  v_factor := NEW.cantidad_teorica / v_rinde;
  FOR v_fila IN
    SELECT rd.id_insumo, rd.cantidad_necesaria AS cantidad,
           ur.factor_a_base AS factor_receta, ur.magnitud AS magnitud_receta,
           ui.factor_a_base AS factor_insumo, ui.magnitud AS magnitud_insumo
      FROM receta_detalle rd
      JOIN unidades_medida ur ON ur.id_unidad = rd.id_unidad_medida
      JOIN insumos i          ON i.id_insumo  = rd.id_insumo
      JOIN unidades_medida ui ON ui.id_unidad = i.id_unidad_medida
     WHERE rd.id_receta = NEW.id_receta AND rd.fase = 'TINA'
  LOOP
    IF v_fila.magnitud_receta <> v_fila.magnitud_insumo THEN
      RAISE EXCEPTION 'El insumo % se compra en % y la receta lo pide en %: no hay forma de convertir entre magnitudes distintas',
        v_fila.id_insumo, v_fila.magnitud_insumo, v_fila.magnitud_receta;
    END IF;
    INSERT INTO movimientos_insumo
      (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (v_fila.id_insumo, NEW.id_sucursal, 'CONSUMO_PRODUCCION',
      -(v_fila.cantidad * v_factor * v_fila.factor_receta / v_fila.factor_insumo),
      NEW.id_produccion, NEW.id_usuario_responsable, NEW.fecha_produccion);
  END LOOP;
  IF v_producto IS NOT NULL THEN
    INSERT INTO movimientos_producto
      (id_producto, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (v_producto, NEW.id_sucursal, 'ALTA_PRODUCCION', NEW.cantidad_real,
            NEW.id_produccion, NEW.id_usuario_responsable, NEW.fecha_produccion);
  END IF;
  RETURN NEW;
END;
$f$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION registrar_consumo_de_fase_tacho()
RETURNS TRIGGER AS $f$
DECLARE
  v_prod RECORD; v_fila RECORD;
BEGIN
  IF NEW.id_lote IS NULL THEN RETURN NEW; END IF;
  SELECT p.id_produccion, p.id_receta, p.id_usuario_responsable INTO v_prod
    FROM lotes l JOIN produccion p ON p.id_produccion = l.id_produccion
   WHERE l.id_lote = NEW.id_lote;
  FOR v_fila IN
    SELECT rd.id_insumo, rd.cantidad_necesaria AS cantidad,
           ur.factor_a_base AS factor_receta, ur.magnitud AS magnitud_receta,
           ui.factor_a_base AS factor_insumo, ui.magnitud AS magnitud_insumo
      FROM receta_detalle rd
      JOIN unidades_medida ur ON ur.id_unidad = rd.id_unidad_medida
      JOIN insumos i          ON i.id_insumo  = rd.id_insumo
      JOIN unidades_medida ui ON ui.id_unidad = i.id_unidad_medida
     WHERE rd.id_receta = v_prod.id_receta AND rd.fase = 'TACHO'
  LOOP
    IF v_fila.magnitud_receta <> v_fila.magnitud_insumo THEN
      RAISE EXCEPTION 'El insumo % se compra en % y la receta lo pide en %: no hay forma de convertir entre magnitudes distintas',
        v_fila.id_insumo, v_fila.magnitud_insumo, v_fila.magnitud_receta;
    END IF;
    INSERT INTO movimientos_insumo
      (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (v_fila.id_insumo, NEW.id_sucursal, 'CONSUMO_PRODUCCION',
      -(v_fila.cantidad * v_fila.factor_receta / v_fila.factor_insumo),
      v_prod.id_produccion, v_prod.id_usuario_responsable, now());
  END LOOP;
  RETURN NEW;
END;
$f$ LANGUAGE plpgsql;

DROP FUNCTION convertir_a_unidad_de_compra(NUMERIC, INTEGER, INTEGER, TEXT);
