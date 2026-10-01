-- Up Migration

-- Dos cambios de como se registra la produccion, definidos con la usuaria el
-- 2026-09-30:
--
-- 1. Se puede producir algo que todavia no tiene receta. La produccion suma
--    al stock igual; los insumos se descuentan solo si hay receta. Por eso la
--    produccion guarda directamente que se produjo (id_sabor o id_producto)
--    en vez de saberlo solo a traves de la receta.
--
-- 2. El helado se produce en tachos de 10 litros, no se pesa en kilos. El
--    lote puede no tener kilos: sus litros son la suma de sus tachos, como ya
--    decia el diseno ("los litros no se guardan: son la suma de los tachos").
--    Sin kilos no hace falta la densidad del sabor para fraccionar.

-- ---------------------------------------------------------------- produccion

ALTER TABLE produccion
  ALTER COLUMN id_receta DROP NOT NULL,
  ADD COLUMN id_sabor    INTEGER REFERENCES sabores (id_sabor) ON DELETE RESTRICT,
  ADD COLUMN id_producto INTEGER REFERENCES productos (id_producto) ON DELETE RESTRICT;

CREATE INDEX produccion_id_sabor_idx ON produccion (id_sabor);
CREATE INDEX produccion_id_producto_idx ON produccion (id_producto);

-- Las producciones que hubiera se completan desde su receta.
UPDATE produccion p
   SET id_sabor = r.id_sabor_resultado, id_producto = r.id_producto_resultado
  FROM recetas r
 WHERE r.id_receta = p.id_receta;

ALTER TABLE produccion
  ADD CONSTRAINT produccion_sabor_o_producto_check
  CHECK (num_nonnulls(id_sabor, id_producto) = 1);

-- Al registrar una produccion: se produce donde hay fabrica, un producto
-- producido tiene que ser de los que se fabrican y llevan stock, y si hay
-- receta tiene que ser la de lo que se produjo.
--
-- Solo al insertar: el comentario de produccion.id_sucursal explica por que
-- no se ata con una FK a tiene_fabrica (el dia que la fabrica se mude, las
-- producciones viejas lo bloquearian). Revisar al insertar no tiene ese
-- problema.
CREATE FUNCTION validar_produccion()
RETURNS TRIGGER AS $$
DECLARE
  v_receta RECORD;
BEGIN
  IF NOT (SELECT tiene_fabrica FROM sucursales WHERE id_sucursal = NEW.id_sucursal) THEN
    RAISE EXCEPTION 'La sucursal % no tiene fabrica: la produccion se registra en la sucursal donde se fabrica', NEW.id_sucursal;
  END IF;

  IF NEW.id_producto IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM productos
        WHERE id_producto = NEW.id_producto
          AND tipo_origen = 'PRODUCIDO_DIRECTO' AND lleva_stock_propio) THEN
    RAISE EXCEPTION 'El producto % no se fabrica con stock propio (no es PRODUCIDO_DIRECTO con stock), asi que no se registra como produccion', NEW.id_producto;
  END IF;

  IF NEW.id_receta IS NOT NULL THEN
    SELECT id_sabor_resultado, id_producto_resultado INTO v_receta
      FROM recetas WHERE id_receta = NEW.id_receta;
    IF v_receta.id_sabor_resultado IS DISTINCT FROM NEW.id_sabor
       OR v_receta.id_producto_resultado IS DISTINCT FROM NEW.id_producto THEN
      RAISE EXCEPTION 'La receta % no es la de lo que se produjo', NEW.id_receta;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_produccion_validar
  BEFORE INSERT ON produccion
  FOR EACH ROW
  EXECUTE FUNCTION validar_produccion();

-- Los movimientos de la produccion. El producto producido suma a su stock
-- desde id_producto, haya receta o no. Los insumos se descuentan solo si hay
-- receta, en proporcion a lo producido contra lo que rinde la receta.
--
-- La cantidad producida esta en la unidad de lo producido: litros para el
-- helado (tachos de 10 L) y la unidad del producto para los productos. Se
-- pasa a la unidad en que rinde la receta; si son de familias distintas (una
-- receta de helado que rinde en kilos), no hay forma de convertir sin la
-- densidad y se avisa en vez de descontar cualquier cosa.
CREATE OR REPLACE FUNCTION registrar_movimientos_de_produccion()
RETURNS TRIGGER AS $$
DECLARE
  v_rinde NUMERIC; v_unidad_rinde INTEGER; v_unidad_producida INTEGER;
  v_magnitud_rinde VARCHAR; v_magnitud_producida VARCHAR; v_que TEXT;
  v_factor NUMERIC; v_fila RECORD;
BEGIN
  IF NEW.id_receta IS NOT NULL THEN
    SELECT r.cantidad_rendimiento, r.id_unidad_rendimiento INTO v_rinde, v_unidad_rinde
      FROM recetas r WHERE r.id_receta = NEW.id_receta;

    IF NEW.id_sabor IS NOT NULL THEN
      SELECT id_unidad INTO v_unidad_producida FROM unidades_medida WHERE abreviatura = 'lt';
      SELECT 'la receta de ' || nombre INTO v_que FROM sabores WHERE id_sabor = NEW.id_sabor;
    ELSE
      SELECT id_unidad_medida, 'la receta de ' || nombre INTO v_unidad_producida, v_que
        FROM productos WHERE id_producto = NEW.id_producto;
    END IF;

    SELECT magnitud INTO v_magnitud_rinde FROM unidades_medida WHERE id_unidad = v_unidad_rinde;
    SELECT magnitud INTO v_magnitud_producida FROM unidades_medida WHERE id_unidad = v_unidad_producida;
    IF v_magnitud_rinde <> v_magnitud_producida THEN
      RAISE EXCEPTION 'No se pueden descontar los insumos: % rinde en una unidad que no convierte con la de lo producido (por ejemplo, kilos contra litros). Corregi cuanto rinde la receta', v_que;
    END IF;

    v_factor := convertir_a_unidad_de_compra(NEW.cantidad_teorica, v_unidad_producida, v_unidad_rinde, v_que)
                / v_rinde;

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
  END IF;

  IF NEW.id_producto IS NOT NULL AND NEW.cantidad_real > 0 THEN
    INSERT INTO movimientos_producto
      (id_producto, id_sucursal, tipo_movimiento, cantidad, id_produccion, id_usuario, fecha_hora)
    VALUES (NEW.id_producto, NEW.id_sucursal, 'ALTA_PRODUCCION', NEW.cantidad_real,
            NEW.id_produccion, NEW.id_usuario_responsable, NEW.fecha_produccion);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN produccion.id_receta IS
  'Receta con que se produjo. Vacia si lo producido todavia no tiene receta: se registra igual, pero no descuenta insumos.';
COMMENT ON COLUMN produccion.id_sabor IS
  'Sabor producido (en tachos de 10 L). Exactamente uno de id_sabor o id_producto.';
COMMENT ON COLUMN produccion.id_producto IS
  'Producto producido, como los impulsivos (en su unidad). Exactamente uno de id_sabor o id_producto.';
COMMENT ON COLUMN produccion.cantidad_teorica IS
  'Cuanto deberia haber salido, en la unidad de lo producido: litros para el helado, la unidad del producto para los productos. Si hay receta, los insumos se descuentan en proporcion a esto.';

-- --------------------------------------------------------------------- lotes

ALTER TABLE lotes ALTER COLUMN cantidad_kg DROP NOT NULL;

COMMENT ON COLUMN lotes.cantidad_kg IS
  'Kilos que salieron de la maquina para este lote, si se pesaron. Vacio cuando la produccion se carga directamente en tachos de 10 L, que es como produce Kokino. Los litros no se guardan: son la suma de los tachos que se llenaron con el lote.';
COMMENT ON COLUMN lotes.id_sabor IS
  'Sabor de la tanda. Lo completa un trigger desde la produccion: no se carga a mano y no puede diferir de lo producido.';

-- El sabor del lote sale de la produccion, no de la receta: la produccion
-- puede no tener receta.
CREATE OR REPLACE FUNCTION completar_sabor_del_lote()
RETURNS TRIGGER AS $$
BEGIN
  SELECT p.id_sabor INTO NEW.id_sabor
    FROM produccion p
   WHERE p.id_produccion = NEW.id_produccion;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validar_lote_de_helado()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT id_sabor FROM produccion WHERE id_produccion = NEW.id_produccion) IS NULL THEN
    RAISE EXCEPTION 'La produccion % no es de un sabor de helado, asi que no puede generar un lote: solo el helado se trazea por lote y se fracciona en tachos', NEW.id_produccion;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- La densidad hace falta para saber cuantos litros rinde un lote pesado en
-- kilos. Un lote cargado directamente en tachos no tiene kilos, y sus litros
-- son sus tachos: ahi no se pide.
CREATE OR REPLACE FUNCTION validar_densidad_al_fraccionar()
RETURNS TRIGGER AS $$
DECLARE
  v_sabor    VARCHAR(100);
  v_densidad NUMERIC;
  v_kg       NUMERIC;
BEGIN
  -- Los tachos del arranque del sistema no tienen lote y quedan afuera: de
  -- esos no se sabe ni de que produccion vienen.
  IF NEW.id_lote IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.nombre, s.densidad_kg_por_litro, l.cantidad_kg INTO v_sabor, v_densidad, v_kg
    FROM lotes l
    JOIN sabores s ON s.id_sabor = l.id_sabor
   WHERE l.id_lote = NEW.id_lote;
  IF v_kg IS NOT NULL AND v_densidad IS NULL THEN
    RAISE EXCEPTION 'El sabor % no tiene cargada la densidad, asi que no se sabe cuantos litros rinde el lote y no se lo puede fraccionar en tachos', v_sabor;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Mismas columnas, pero el sabor sale del lote y no de la receta, para que
-- tambien alcance a la produccion sin receta. Un lote sin kilos no puede
-- estar sobrefraccionado: sus litros son justamente sus tachos.
CREATE OR REPLACE VIEW alertas_lotes_sobrefraccionados AS
 SELECT l.codigo_lote,
    sa.nombre AS sabor,
    l.cantidad_kg,
    sa.densidad_kg_por_litro AS densidad,
    round((l.cantidad_kg / sa.densidad_kg_por_litro), 2) AS litros_del_lote,
    sum(t.capacidad_litros) AS litros_en_tachos,
    count(t.id_tacho) AS tachos,
    round((sum(t.capacidad_litros) - (l.cantidad_kg / sa.densidad_kg_por_litro)), 2) AS exceso_litros
   FROM lotes l
     JOIN sabores sa ON sa.id_sabor = l.id_sabor
     JOIN tachos t ON t.id_lote = l.id_lote
  GROUP BY l.id_lote, l.codigo_lote, sa.nombre, l.cantidad_kg, sa.densidad_kg_por_litro
 HAVING (sum(t.capacidad_litros) > (l.cantidad_kg / sa.densidad_kg_por_litro));

-- Down Migration

-- Vuelve a la version anterior de cada cosa. Falla si ya hay producciones sin
-- receta o lotes sin kilos, que la version anterior no admite: en ese caso no
-- hay que revertir, sino corregir hacia adelante.

CREATE OR REPLACE VIEW alertas_lotes_sobrefraccionados AS
 SELECT l.codigo_lote,
    sa.nombre AS sabor,
    l.cantidad_kg,
    sa.densidad_kg_por_litro AS densidad,
    round((l.cantidad_kg / sa.densidad_kg_por_litro), 2) AS litros_del_lote,
    sum(t.capacidad_litros) AS litros_en_tachos,
    count(t.id_tacho) AS tachos,
    round((sum(t.capacidad_litros) - (l.cantidad_kg / sa.densidad_kg_por_litro)), 2) AS exceso_litros
   FROM ((((lotes l
     JOIN produccion p ON ((p.id_produccion = l.id_produccion)))
     JOIN recetas r ON ((r.id_receta = p.id_receta)))
     JOIN sabores sa ON ((sa.id_sabor = r.id_sabor_resultado)))
     JOIN tachos t ON ((t.id_lote = l.id_lote)))
  GROUP BY l.id_lote, l.codigo_lote, sa.nombre, l.cantidad_kg, sa.densidad_kg_por_litro
 HAVING (sum(t.capacidad_litros) > (l.cantidad_kg / sa.densidad_kg_por_litro));

CREATE OR REPLACE FUNCTION validar_densidad_al_fraccionar()
RETURNS TRIGGER AS $$
DECLARE
  v_sabor    VARCHAR(100);
  v_densidad NUMERIC;
BEGIN
  -- Los tachos del arranque del sistema no tienen lote y quedan afuera: de
  -- esos no se sabe ni de que produccion vienen.
  IF NEW.id_lote IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.nombre, s.densidad_kg_por_litro INTO v_sabor, v_densidad
    FROM lotes l
    JOIN produccion p ON p.id_produccion = l.id_produccion
    JOIN recetas r    ON r.id_receta     = p.id_receta
    JOIN sabores s    ON s.id_sabor      = r.id_sabor_resultado
   WHERE l.id_lote = NEW.id_lote;
  IF v_densidad IS NULL THEN
    RAISE EXCEPTION 'El sabor % no tiene cargada la densidad, asi que no se sabe cuantos litros rinde el lote y no se lo puede fraccionar en tachos', v_sabor;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validar_lote_de_helado()
RETURNS TRIGGER AS $$
DECLARE
  v_sabor INTEGER;
BEGIN
  SELECT r.id_sabor_resultado INTO v_sabor
    FROM produccion p
    JOIN recetas r ON r.id_receta = p.id_receta
   WHERE p.id_produccion = NEW.id_produccion;
  IF v_sabor IS NULL THEN
    RAISE EXCEPTION 'La produccion % no es de un sabor de helado, asi que no puede generar un lote: solo el helado se trazea por lote y se fracciona en tachos', NEW.id_produccion;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION completar_sabor_del_lote()
RETURNS TRIGGER AS $$
BEGIN
  SELECT r.id_sabor_resultado INTO NEW.id_sabor
    FROM produccion p JOIN recetas r ON r.id_receta = p.id_receta
   WHERE p.id_produccion = NEW.id_produccion;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN lotes.id_sabor IS
  'Sabor de la tanda. Lo completa un trigger desde la produccion: no se carga a mano y no puede diferir de la receta. Se guarda en vez de deducirse porque preguntar que gustos hay en una sucursal es la consulta mas frecuente del sistema, y deducirlo obliga a recorrer produccion y receta en cada una.';
COMMENT ON COLUMN lotes.cantidad_kg IS
  'Kilos que salieron de la máquina para este lote. Los litros no se guardan: son la suma de los tachos que se llenaron con él, así que derivarlos evita que dos números midan lo mismo y se contradigan.';
ALTER TABLE lotes ALTER COLUMN cantidad_kg SET NOT NULL;

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

DROP TRIGGER trg_produccion_validar ON produccion;
DROP FUNCTION validar_produccion();

COMMENT ON COLUMN produccion.cantidad_teorica IS
  'Cuánto debería haber salido según la fórmula, en la unidad de rendimiento de la receta. Puede ser un múltiplo del rendimiento si se hicieron varias tandas en la misma corrida.';
COMMENT ON COLUMN produccion.id_receta IS NULL;

ALTER TABLE produccion DROP CONSTRAINT produccion_sabor_o_producto_check;
DROP INDEX produccion_id_producto_idx;
DROP INDEX produccion_id_sabor_idx;
ALTER TABLE produccion
  DROP COLUMN id_producto,
  DROP COLUMN id_sabor,
  ALTER COLUMN id_receta SET NOT NULL;
