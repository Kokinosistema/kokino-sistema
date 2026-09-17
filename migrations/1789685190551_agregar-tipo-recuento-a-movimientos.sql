-- Up Migration

-- Kokino no tiene el stock registrado en ningun lado: el dia que arranque el
-- sistema van a contar el deposito y cargar lo que hay. Eso no es una compra
-- ni una perdida, es el conteo poniendo al sistema al dia, y por eso lleva
-- tipo propio en vez de entrar como AJUSTE.
--
-- Separarlos importa para los reportes: con un solo tipo no se podria
-- distinguir cuanto se perdio por roturas de cuanto corrigio un conteo. Y no
-- sirve solo para el arranque: van a recontar cada tanto.
--
-- Admite los dos signos, igual que el ajuste, porque un conteo puede encontrar
-- de mas o de menos.
ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_tipo_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_tipo_check
  CHECK (tipo_movimiento IN ('ENTRADA_COMPRA', 'CONSUMO_PRODUCCION', 'AJUSTE', 'RECUENTO'));

ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_signo_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_signo_check
  CHECK (
    (tipo_movimiento = 'ENTRADA_COMPRA' AND cantidad > 0)
    OR (tipo_movimiento = 'CONSUMO_PRODUCCION' AND cantidad < 0)
    OR tipo_movimiento IN ('AJUSTE', 'RECUENTO')
  );

ALTER TABLE movimientos_producto DROP CONSTRAINT movimientos_producto_tipo_check;
ALTER TABLE movimientos_producto ADD CONSTRAINT movimientos_producto_tipo_check
  CHECK (tipo_movimiento IN (
    'ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'SALIDA_VENTA',
    'ENTRADA_TRASLADO', 'SALIDA_TRASLADO', 'AJUSTE', 'RECUENTO'
  ));

ALTER TABLE movimientos_producto DROP CONSTRAINT movimientos_producto_signo_check;
ALTER TABLE movimientos_producto ADD CONSTRAINT movimientos_producto_signo_check
  CHECK (
    (tipo_movimiento IN ('ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'ENTRADA_TRASLADO') AND cantidad > 0)
    OR (tipo_movimiento IN ('SALIDA_VENTA', 'SALIDA_TRASLADO') AND cantidad < 0)
    OR tipo_movimiento IN ('AJUSTE', 'RECUENTO')
  );

COMMENT ON COLUMN movimientos_insumo.tipo_movimiento IS
  'Los insumos entran por compra, se consumen en produccion, se ajustan o se recuentan. No se venden ni se trasladan entre sucursales, porque cada sucursal le compra lo suyo. RECUENTO es el conteo fisico del deposito: se usa el dia que arranca el sistema para cargar el stock que ya existia, y despues cada vez que cuenten.';

COMMENT ON COLUMN movimientos_producto.tipo_movimiento IS
  'A diferencia de los insumos, los productos ademas se venden y viajan entre sucursales. RECUENTO es el conteo fisico, tanto el del arranque como los periodicos. SALIDA_VENTA todavia no tiene FK a la venta porque el modulo de ventas se creo despues.';

-- Down Migration

ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_signo_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_signo_check
  CHECK (
    (tipo_movimiento = 'ENTRADA_COMPRA' AND cantidad > 0)
    OR (tipo_movimiento = 'CONSUMO_PRODUCCION' AND cantidad < 0)
    OR tipo_movimiento = 'AJUSTE'
  );
ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_tipo_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_tipo_check
  CHECK (tipo_movimiento IN ('ENTRADA_COMPRA', 'CONSUMO_PRODUCCION', 'AJUSTE'));

ALTER TABLE movimientos_producto DROP CONSTRAINT movimientos_producto_signo_check;
ALTER TABLE movimientos_producto ADD CONSTRAINT movimientos_producto_signo_check
  CHECK (
    (tipo_movimiento IN ('ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'ENTRADA_TRASLADO') AND cantidad > 0)
    OR (tipo_movimiento IN ('SALIDA_VENTA', 'SALIDA_TRASLADO') AND cantidad < 0)
    OR tipo_movimiento = 'AJUSTE'
  );
ALTER TABLE movimientos_producto DROP CONSTRAINT movimientos_producto_tipo_check;
ALTER TABLE movimientos_producto ADD CONSTRAINT movimientos_producto_tipo_check
  CHECK (tipo_movimiento IN (
    'ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'SALIDA_VENTA',
    'ENTRADA_TRASLADO', 'SALIDA_TRASLADO', 'AJUSTE'
  ));
