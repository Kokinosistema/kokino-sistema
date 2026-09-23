-- Up Migration

-- Repone CONSUMO_VENTA en los dos CHECK de movimientos_insumo.
--
-- Que paso: la migracion que agrego RECUENTO reescribio estos dos CHECK
-- completos, pero los escribio desde la version anterior a que existiera
-- CONSUMO_VENTA. Al reemplazar un CHECK hay que partir de como esta en la base
-- en ese momento, no de como uno lo escribio la primera vez: entre medio pudo
-- haberlo cambiado otra migracion, y eso fue justo lo que aca paso.
--
-- Consecuencia: el trigger que descuenta el cono al vender un cucurucho
-- intentaba insertar un CONSUMO_VENTA que el CHECK ya no admitia, asi que
-- vender cualquier producto con insumos asociados iba a fallar entero. No
-- descontaba mal, directamente no dejaba registrar la venta.
--
-- Ademas quedaba una contradiccion: venta_coherente_check exige que
-- CONSUMO_VENTA vaya con id_venta y viceversa, sobre un valor que el otro
-- CHECK prohibia. La columna id_venta no podia tener valor nunca.
ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_tipo_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_tipo_check
  CHECK (tipo_movimiento IN (
    'ENTRADA_COMPRA', 'CONSUMO_PRODUCCION', 'CONSUMO_VENTA', 'AJUSTE', 'RECUENTO'
  ));

ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_signo_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_signo_check
  CHECK (
    (tipo_movimiento = 'ENTRADA_COMPRA' AND cantidad > 0)
    OR (tipo_movimiento IN ('CONSUMO_PRODUCCION', 'CONSUMO_VENTA') AND cantidad < 0)
    OR tipo_movimiento IN ('AJUSTE', 'RECUENTO')
  );

-- El comentario tambien se habia pisado y quedo diciendo que los insumos no se
-- venden, que es lo contrario de lo que hace el trigger.
COMMENT ON COLUMN movimientos_insumo.tipo_movimiento IS
  'Los insumos entran por compra y salen de dos formas: consumidos al fabricar (CONSUMO_PRODUCCION, contra una produccion) o gastados al vender (CONSUMO_VENTA, como el cono de un cucurucho o el envase de un termico). AJUSTE corrige diferencias y RECUENTO es el conteo fisico del deposito, tanto el del arranque del sistema como los periodicos. No se trasladan entre sucursales, porque cada una le compra a sus proveedores.';

-- Down Migration

-- Revertir devuelve los CHECK sin CONSUMO_VENTA, o sea que reintroduce el
-- error. Ademas falla si ya hay movimientos de ese tipo cargados, que es lo
-- correcto: habria que decidir que hacer con ellos antes, no que una migracion
-- los deje invalidos en silencio.
ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_signo_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_signo_check
  CHECK (
    (tipo_movimiento = 'ENTRADA_COMPRA' AND cantidad > 0)
    OR (tipo_movimiento = 'CONSUMO_PRODUCCION' AND cantidad < 0)
    OR tipo_movimiento IN ('AJUSTE', 'RECUENTO')
  );

ALTER TABLE movimientos_insumo DROP CONSTRAINT movimientos_insumo_tipo_check;
ALTER TABLE movimientos_insumo ADD CONSTRAINT movimientos_insumo_tipo_check
  CHECK (tipo_movimiento IN ('ENTRADA_COMPRA', 'CONSUMO_PRODUCCION', 'AJUSTE', 'RECUENTO'));
