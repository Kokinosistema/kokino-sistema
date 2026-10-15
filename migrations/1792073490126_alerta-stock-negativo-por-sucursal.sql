-- Up Migration

-- La alerta de stock negativo pasa a mostrarse en el Inicio de los duenos
-- (pedido de la usuaria el 2026-10-15; hasta ahora no la usaba ninguna
-- pantalla). Para eso la vista suma dos columnas al final:
--
--   - id_sucursal: el Inicio muestra la sucursal que se esta mirando. Filtrar
--     por el nombre andaria, pero si se renombrara una sucursal la alerta
--     dejaria de aparecer sin que nadie lo note.
--   - unidad: "-0,5" no dice nada sin saber si son kilos o litros. Los
--     productos se cuentan siempre por unidad (su id_unidad_medida es la de
--     su contenido, como los 3 lt de un familiar, no la de su stock); los
--     insumos, en su unidad de compra, que es en la que se mueve su stock.
--
-- Agrupa por id y no por nombre, y las columnas de antes quedan iguales y en
-- el mismo orden, asi CREATE OR REPLACE la cambia sin tener que borrarla.

CREATE OR REPLACE VIEW alertas_stock_negativo AS
SELECT 'PRODUCTO' AS tipo, p.nombre AS item, s.nombre AS sucursal, sum(m.cantidad) AS saldo,
       s.id_sucursal, 'un'::varchar(10) AS unidad
  FROM movimientos_producto m
  JOIN productos p  ON p.id_producto = m.id_producto
  JOIN sucursales s ON s.id_sucursal = m.id_sucursal
 GROUP BY p.id_producto, p.nombre, s.id_sucursal, s.nombre
HAVING sum(m.cantidad) < 0
UNION ALL
SELECT 'INSUMO', i.nombre, s.nombre, sum(m.cantidad),
       s.id_sucursal, u.abreviatura
  FROM movimientos_insumo m
  JOIN insumos i         ON i.id_insumo  = m.id_insumo
  JOIN unidades_medida u ON u.id_unidad  = i.id_unidad_medida
  JOIN sucursales s      ON s.id_sucursal = m.id_sucursal
 GROUP BY i.id_insumo, i.nombre, u.abreviatura, s.id_sucursal, s.nombre
HAVING sum(m.cantidad) < 0;

COMMENT ON VIEW alertas_stock_negativo IS
  'Productos e insumos cuyo stock quedo en negativo, por sucursal. No es un error de la base sino una senal para quien administra: o falta registrar una compra o un recuento, o se cargo mal una salida. Se avisa y no se bloquea a proposito, porque frenar una venta real con la mercaderia en la mano seria peor. La muestra el Inicio de los duenos.';

-- Down Migration

-- CREATE OR REPLACE no puede sacar columnas: se baja y se vuelve a crear
-- como estaba.
DROP VIEW alertas_stock_negativo;

CREATE VIEW alertas_stock_negativo AS
SELECT 'PRODUCTO' AS tipo, p.nombre AS item, s.nombre AS sucursal, sum(m.cantidad) AS saldo
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
