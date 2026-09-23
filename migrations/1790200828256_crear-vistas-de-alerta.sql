-- Up Migration

-- Dos controles que se decidio que avisen en lugar de frenar, porque frenarlos
-- haria mas dano que el problema que evitan.
--
-- El stock en negativo no se puede vigilar con un CHECK: el stock no es una
-- columna sino la suma de los movimientos, y un CHECK solo ve la fila que se
-- esta insertando. Podria hacerse con un trigger que sume, pero bloquear una
-- venta porque el sistema cree que no hay mercaderia, con el producto en la
-- mano del cliente, es peor que el negativo. El negativo es justamente la
-- senal de que falta cargar algo.
CREATE VIEW alertas_stock_negativo AS
SELECT 'PRODUCTO' AS tipo,
       p.nombre   AS item,
       s.nombre   AS sucursal,
       sum(m.cantidad) AS saldo
  FROM movimientos_producto m
  JOIN productos p  ON p.id_producto = m.id_producto
  JOIN sucursales s ON s.id_sucursal = m.id_sucursal
 GROUP BY p.nombre, s.nombre
HAVING sum(m.cantidad) < 0
UNION ALL
SELECT 'INSUMO', i.nombre, s.nombre, sum(m.cantidad)
  FROM movimientos_insumo m
  JOIN insumos i    ON i.id_insumo   = m.id_insumo
  JOIN sucursales s ON s.id_sucursal = m.id_sucursal
 GROUP BY i.nombre, s.nombre
HAVING sum(m.cantidad) < 0;

COMMENT ON VIEW alertas_stock_negativo IS
  'Productos e insumos cuyo stock quedo en negativo. No es un error de la base sino una senal para quien administra: o falta registrar una compra o un recuento, o se cargo mal una salida. Se avisa y no se bloquea a proposito, porque frenar una venta real con la mercaderia en la mano seria peor.';

-- Un lote de 5 kg fraccionado en 20 tachos de 10 litros no lo impedia nada.
-- Tampoco se bloquea: el fraccionamiento real puede diferir un poco de la
-- cuenta teorica, y frenar al encargado a mitad de tarea seria peor que
-- revisarlo despues. Los desvios grandes saltan igual en esta vista.
CREATE VIEW alertas_lotes_sobrefraccionados AS
SELECT l.codigo_lote,
       sa.nombre                                   AS sabor,
       l.cantidad_kg,
       sa.densidad_kg_por_litro                    AS densidad,
       round(l.cantidad_kg / sa.densidad_kg_por_litro, 2) AS litros_del_lote,
       sum(t.capacidad_litros)                     AS litros_en_tachos,
       count(t.id_tacho)                           AS tachos,
       round(sum(t.capacidad_litros) - l.cantidad_kg / sa.densidad_kg_por_litro, 2) AS exceso_litros
  FROM lotes l
  JOIN produccion p ON p.id_produccion = l.id_produccion
  JOIN recetas r    ON r.id_receta     = p.id_receta
  JOIN sabores sa   ON sa.id_sabor     = r.id_sabor_resultado
  JOIN tachos t     ON t.id_lote       = l.id_lote
 GROUP BY l.id_lote, l.codigo_lote, sa.nombre, l.cantidad_kg, sa.densidad_kg_por_litro
HAVING sum(t.capacidad_litros) > l.cantidad_kg / sa.densidad_kg_por_litro;

COMMENT ON VIEW alertas_lotes_sobrefraccionados IS
  'Lotes cuyos tachos suman mas litros de los que el lote puede rendir segun su peso y la densidad del sabor. Sirve para detectar un error de carga, como fraccionar veinte tachos de un lote de cinco kilos.';

-- Down Migration

DROP VIEW alertas_lotes_sobrefraccionados;
DROP VIEW alertas_stock_negativo;
