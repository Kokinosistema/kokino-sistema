-- Up Migration

-- Producir no generaba ningun movimiento de stock: ni el consumo de los
-- insumos ni el alta del producto terminado. Era el unico modulo sin triggers,
-- justo el que la duena pidio explicitamente que fuera automatico, para que el
-- encargado cargue cuanto helado salio y no tenga que anotar insumo por
-- insumo.
--
-- Los ingredientes se consumen en dos momentos distintos, y eso lo decide la
-- columna fase de la receta:
--
--   TINA  va en la mezcla base, asi que se consume al registrar la produccion,
--         escalado por cuantas veces se hizo la formula.
--   TACHO se agrega al fraccionar y la receta lo expresa por tacho ("nueces
--         200 gr"), asi que se consume al crear cada tacho, no antes: cuanto
--         se gasta depende de cuantos tachos salgan.
--
-- El consumo se escala con la cantidad teorica y no con la real, porque los
-- insumos que entraron a la maquina son los que la formula pedia; si salio
-- menos por merma, se gastaron igual.
CREATE FUNCTION registrar_movimientos_de_produccion()
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
    VALUES (
      v_fila.id_insumo, NEW.id_sucursal, 'CONSUMO_PRODUCCION',
      -(v_fila.cantidad * v_factor * v_fila.factor_receta / v_fila.factor_insumo),
      NEW.id_produccion, NEW.id_usuario_responsable, NEW.fecha_produccion
    );
  END LOOP;

  -- El helado no da alta de stock aca: sus unidades son los tachos, y contarlo
  -- tambien como movimiento seria contar el mismo helado dos veces. Solo los
  -- productos terminados, como una tanda de tortas, entran al stock.
  IF v_producto IS NOT NULL THEN
    INSERT INTO movimientos_producto
      (id_producto, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (v_producto, NEW.id_sucursal, 'ALTA_PRODUCCION', NEW.cantidad_real,
            NEW.id_produccion, NEW.id_usuario_responsable, NEW.fecha_produccion);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_produccion_registrar_movimientos
  AFTER INSERT ON produccion
  FOR EACH ROW EXECUTE FUNCTION registrar_movimientos_de_produccion();

-- Lo que se agrega al fraccionar, un tacho por vez.
CREATE FUNCTION registrar_consumo_de_fase_tacho()
RETURNS TRIGGER AS $$
DECLARE
  v_prod  RECORD;
  v_fila  RECORD;
BEGIN
  IF NEW.id_lote IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.id_produccion, p.id_receta, p.id_sucursal, p.id_usuario_responsable
    INTO v_prod
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
    VALUES (
      v_fila.id_insumo, NEW.id_sucursal, 'CONSUMO_PRODUCCION',
      -(v_fila.cantidad * v_fila.factor_receta / v_fila.factor_insumo),
      v_prod.id_produccion, v_prod.id_usuario_responsable, now()
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tachos_consumir_fase_tacho
  AFTER INSERT ON tachos
  FOR EACH ROW EXECUTE FUNCTION registrar_consumo_de_fase_tacho();

COMMENT ON FUNCTION registrar_movimientos_de_produccion() IS
  'Al registrar una produccion descuenta los insumos de fase TINA segun la receta y da de alta el producto terminado si la receta produce uno. El helado no se da de alta aca porque sus unidades son los tachos.';
COMMENT ON FUNCTION registrar_consumo_de_fase_tacho() IS
  'Descuenta los insumos de fase TACHO al crear cada tacho, porque la receta los expresa por tacho y cuanto se gasta depende de cuantos salgan.';

-- Down Migration

DROP TRIGGER trg_tachos_consumir_fase_tacho ON tachos;
DROP FUNCTION registrar_consumo_de_fase_tacho();
DROP TRIGGER trg_produccion_registrar_movimientos ON produccion;
DROP FUNCTION registrar_movimientos_de_produccion();
