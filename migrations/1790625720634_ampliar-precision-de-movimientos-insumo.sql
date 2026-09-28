-- Up Migration

-- movimientos_insumo.cantidad guarda siempre en la unidad de compra del
-- insumo, asi que una receta que pide gramos de algo que se compra por kilo
-- termina guardando milesimas de kilo. Con tres decimales eso se rompia:
--
--   la receta pide   deberia guardar   guardaba
--   0,4 gr           0,0004 kg         0,000     -> la operacion entera falla
--   1,4 gr           0,0014 kg         0,001     -> 29% de error, en silencio
--
-- El primero rompe con el CHECK de cantidad distinta de cero y frena la venta.
-- El segundo es peor, porque no falla: descuenta de menos y el costo por kilo
-- de helado sale mal, que es justamente la cuenta que el sistema vino a hacer.
-- Pega en esencias, colorantes y estabilizantes, que son los que se piden en
-- gramos o menos y se compran por kilo.
--
-- Seis decimales alcanzan de sobra: permiten hasta centesimas de gramo
-- expresadas en kilos.
-- La vista de alertas usa esta columna, y PostgreSQL no deja cambiarle el tipo
-- mientras algo dependa de ella. Se baja y se vuelve a crear igual.
DROP VIEW alertas_stock_negativo;

ALTER TABLE movimientos_insumo ALTER COLUMN cantidad TYPE NUMERIC(14,6);

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


COMMENT ON COLUMN movimientos_insumo.cantidad IS
  'Cantidad con signo, siempre en la unidad de compra del insumo. Positiva si entra, negativa si sale. Lleva seis decimales porque una receta puede pedir gramos de algo que se compra por kilo, y con menos precision esas cantidades se redondean a cero o pierden una parte importante sin que nada avise.';

-- Down Migration

-- Volver a tres decimales redondea lo que ya este guardado, asi que no es una
-- reversion limpia: las cantidades chicas se pierden. Se revierte igual porque
-- es la unica forma de deshacerlo, pero conviene saberlo antes de correrlo.
DROP VIEW alertas_stock_negativo;

ALTER TABLE movimientos_insumo ALTER COLUMN cantidad TYPE NUMERIC(14,3);

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

