-- Up Migration

-- Correcciones puntuales salidas de una revision externa del esquema. Van
-- juntas porque son de la misma naturaleza: reglas que el esquema decia tener
-- y no verificaba.

-- 1. Una produccion perdida entera no se podia registrar. El CHECK de
-- produccion admite cantidad_real = 0, pero el trigger metia ese cero en
-- movimientos_producto, que exige cantidad distinta de cero. Justo el caso en
-- que mas importa dejar constancia de lo que se gasto era el que fallaba.
-- Ahora el alta de stock ocurre solo si salio algo; los insumos se consumen
-- igual, porque entraron a la maquina.
CREATE OR REPLACE FUNCTION registrar_movimientos_de_produccion()
RETURNS TRIGGER AS $$
DECLARE
  v_producto INTEGER; v_rinde NUMERIC; v_factor NUMERIC; v_fila RECORD;
BEGIN
  SELECT r.id_producto_resultado, r.cantidad_rendimiento INTO v_producto, v_rinde
    FROM recetas r WHERE r.id_receta = NEW.id_receta;
  v_factor := NEW.cantidad_teorica / v_rinde;
  FOR v_fila IN
    SELECT rd.id_insumo, rd.cantidad_necesaria AS cantidad,
           rd.id_unidad_medida AS unidad_receta,
           i.id_unidad_medida AS unidad_compra, i.nombre
      FROM receta_detalle rd JOIN insumos i ON i.id_insumo = rd.id_insumo
     WHERE rd.id_receta = NEW.id_receta AND rd.fase = 'TINA'
  LOOP
    INSERT INTO movimientos_insumo
      (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (v_fila.id_insumo, NEW.id_sucursal, 'CONSUMO_PRODUCCION',
      -convertir_a_unidad_de_compra(v_fila.cantidad * v_factor, v_fila.unidad_receta,
                                    v_fila.unidad_compra, 'El insumo ' || v_fila.nombre),
      NEW.id_produccion, NEW.id_usuario_responsable, NEW.fecha_produccion);
  END LOOP;
  IF v_producto IS NOT NULL AND NEW.cantidad_real > 0 THEN
    INSERT INTO movimientos_producto
      (id_producto, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (v_producto, NEW.id_sucursal, 'ALTA_PRODUCCION', NEW.cantidad_real,
            NEW.id_produccion, NEW.id_usuario_responsable, NEW.fecha_produccion);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. El insumo de fase TACHO se descontaba de la sucursal del tacho en lugar
-- de la de la produccion. En la practica coinciden, porque el tacho se crea
-- donde se produjo, pero dejaba un movimiento cuyo id_produccion apuntaba a
-- una sucursal distinta de la suya.
CREATE OR REPLACE FUNCTION registrar_consumo_de_fase_tacho()
RETURNS TRIGGER AS $$
DECLARE
  v_prod RECORD; v_fila RECORD;
BEGIN
  IF NEW.id_lote IS NULL THEN RETURN NEW; END IF;
  SELECT p.id_produccion, p.id_receta, p.id_sucursal, p.id_usuario_responsable INTO v_prod
    FROM lotes l JOIN produccion p ON p.id_produccion = l.id_produccion
   WHERE l.id_lote = NEW.id_lote;
  FOR v_fila IN
    SELECT rd.id_insumo, rd.cantidad_necesaria AS cantidad,
           rd.id_unidad_medida AS unidad_receta,
           i.id_unidad_medida AS unidad_compra, i.nombre
      FROM receta_detalle rd JOIN insumos i ON i.id_insumo = rd.id_insumo
     WHERE rd.id_receta = v_prod.id_receta AND rd.fase = 'TACHO'
  LOOP
    INSERT INTO movimientos_insumo
      (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (v_fila.id_insumo, v_prod.id_sucursal, 'CONSUMO_PRODUCCION',
      -convertir_a_unidad_de_compra(v_fila.cantidad, v_fila.unidad_receta,
                                    v_fila.unidad_compra, 'El insumo ' || v_fila.nombre),
      v_prod.id_produccion, v_prod.id_usuario_responsable, now());
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Se podia cargar una receta de produccion sobre un producto comprado
-- terminado. La FK compuesta contra productos ya existia para esto.
ALTER TABLE recetas ADD COLUMN tipo_origen_producto VARCHAR(30) NOT NULL DEFAULT 'PRODUCIDO_DIRECTO';
ALTER TABLE recetas ADD CONSTRAINT recetas_tipo_origen_producto_check
  CHECK (tipo_origen_producto = 'PRODUCIDO_DIRECTO');
ALTER TABLE recetas ADD CONSTRAINT recetas_producto_producido_fkey
  FOREIGN KEY (id_producto_resultado, tipo_origen_producto)
  REFERENCES productos (id_producto, tipo_origen) ON DELETE RESTRICT;

COMMENT ON COLUMN recetas.tipo_origen_producto IS
  'Fijo en PRODUCIDO_DIRECTO por CHECK. Junto con id_producto_resultado forma la FK compuesta contra productos, que impide cargar una receta de produccion sobre algo que se compra hecho. Cuando la receta produce un sabor, id_producto_resultado es nulo y PostgreSQL no valida la clave.';

-- 4. El CHECK de egresos prohibia el empleado sin retiro, pero admitia el
-- retiro sin empleado: plata saliendo a cuenta de sueldo de nadie.
ALTER TABLE egresos DROP CONSTRAINT egresos_empleado_solo_en_retiro_check;
ALTER TABLE egresos ADD CONSTRAINT egresos_empleado_solo_en_retiro_check
  CHECK ((id_empleado IS NOT NULL) = (tipo_egreso = 'RETIRO_EMPLEADO'));

-- 5. Dos reglas fiscales que el esquema describia y no verificaba: una nota de
-- credito sin decir que factura cancela, que AFIP no acepta, y un comprobante
-- interno con CAE pese a no ser fiscal.
CREATE FUNCTION validar_comprobante()
RETURNS TRIGGER AS $$
DECLARE
  v_signo SMALLINT; v_requiere BOOLEAN; v_nombre VARCHAR(50);
BEGIN
  SELECT signo, requiere_cae, nombre INTO v_signo, v_requiere, v_nombre
    FROM tipos_comprobante WHERE id_tipo_comprobante = NEW.id_tipo_comprobante;
  IF v_signo = -1 AND NEW.id_comprobante_origen IS NULL THEN
    RAISE EXCEPTION 'Una % tiene que indicar que comprobante cancela: AFIP no acepta una nota de credito suelta', v_nombre;
  END IF;
  IF NOT v_requiere AND NEW.cae IS NOT NULL THEN
    RAISE EXCEPTION 'Un % no es un comprobante fiscal, asi que no puede llevar CAE: AFIP nunca lo autorizo', v_nombre;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_comprobantes_validar
  BEFORE INSERT OR UPDATE ON comprobantes
  FOR EACH ROW EXECUTE FUNCTION validar_comprobante();

-- 6. El comentario de sucursal_horarios prometia alimentar una validacion de
-- apertura de caja que nunca se escribio. Se corrige el texto en lugar de
-- inventar la validacion: abrir fuera de horario pasa de verdad, y frenarlo
-- seria mas molesto que util.
COMMENT ON TABLE sucursal_horarios IS
  'Horario de atencion de cada sucursal, una fila por dia de la semana. Un dia sin fila es un dia en que el local no abre. Es informativo: no restringe la apertura de caja, porque un turno puede empezar antes o terminar despues del horario publicado.';

-- 7. Correccion de un comentario de la migracion que agrego el sabor al lote.
-- Ahi se afirmo que trg_lotes_completar_sabor corre despues del que valida que
-- la produccion sea de helado. Es al reves: los BEFORE corren por orden
-- alfabetico y completar_sabor va primero. No cambia el resultado, porque el
-- NOT NULL se evalua despues de todos los BEFORE, pero el razonamiento estaba
-- invertido y no conviene que se cite como precedente.

-- Down Migration

DROP TRIGGER trg_comprobantes_validar ON comprobantes;
DROP FUNCTION validar_comprobante();

ALTER TABLE egresos DROP CONSTRAINT egresos_empleado_solo_en_retiro_check;
ALTER TABLE egresos ADD CONSTRAINT egresos_empleado_solo_en_retiro_check
  CHECK (id_empleado IS NULL OR tipo_egreso = 'RETIRO_EMPLEADO');

ALTER TABLE recetas DROP CONSTRAINT recetas_producto_producido_fkey;
ALTER TABLE recetas DROP CONSTRAINT recetas_tipo_origen_producto_check;
ALTER TABLE recetas DROP COLUMN tipo_origen_producto;

COMMENT ON TABLE sucursal_horarios IS
  'Horario de atencion de cada sucursal, una fila por dia de la semana. Un dia sin fila es un dia en que el local no abre. Alimenta la validacion de apertura de caja: no se deberia abrir un turno fuera del horario del local.';

CREATE OR REPLACE FUNCTION registrar_consumo_de_fase_tacho()
RETURNS TRIGGER AS $$
DECLARE
  v_prod RECORD; v_fila RECORD;
BEGIN
  IF NEW.id_lote IS NULL THEN RETURN NEW; END IF;
  SELECT p.id_produccion, p.id_receta, p.id_usuario_responsable INTO v_prod
    FROM lotes l JOIN produccion p ON p.id_produccion = l.id_produccion
   WHERE l.id_lote = NEW.id_lote;
  FOR v_fila IN
    SELECT rd.id_insumo, rd.cantidad_necesaria AS cantidad,
           rd.id_unidad_medida AS unidad_receta,
           i.id_unidad_medida AS unidad_compra, i.nombre
      FROM receta_detalle rd JOIN insumos i ON i.id_insumo = rd.id_insumo
     WHERE rd.id_receta = v_prod.id_receta AND rd.fase = 'TACHO'
  LOOP
    INSERT INTO movimientos_insumo
      (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (v_fila.id_insumo, NEW.id_sucursal, 'CONSUMO_PRODUCCION',
      -convertir_a_unidad_de_compra(v_fila.cantidad, v_fila.unidad_receta,
                                    v_fila.unidad_compra, 'El insumo ' || v_fila.nombre),
      v_prod.id_produccion, v_prod.id_usuario_responsable, now());
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION registrar_movimientos_de_produccion()
RETURNS TRIGGER AS $$
DECLARE
  v_producto INTEGER; v_rinde NUMERIC; v_factor NUMERIC; v_fila RECORD;
BEGIN
  SELECT r.id_producto_resultado, r.cantidad_rendimiento INTO v_producto, v_rinde
    FROM recetas r WHERE r.id_receta = NEW.id_receta;
  v_factor := NEW.cantidad_teorica / v_rinde;
  FOR v_fila IN
    SELECT rd.id_insumo, rd.cantidad_necesaria AS cantidad,
           rd.id_unidad_medida AS unidad_receta,
           i.id_unidad_medida AS unidad_compra, i.nombre
      FROM receta_detalle rd JOIN insumos i ON i.id_insumo = rd.id_insumo
     WHERE rd.id_receta = NEW.id_receta AND rd.fase = 'TINA'
  LOOP
    INSERT INTO movimientos_insumo
      (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (v_fila.id_insumo, NEW.id_sucursal, 'CONSUMO_PRODUCCION',
      -convertir_a_unidad_de_compra(v_fila.cantidad * v_factor, v_fila.unidad_receta,
                                    v_fila.unidad_compra, 'El insumo ' || v_fila.nombre),
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
$$ LANGUAGE plpgsql;
