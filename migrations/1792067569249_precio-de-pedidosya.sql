-- Up Migration

-- Precio de PedidosYa (pedido de la usuaria el 2026-10-15): en la plataforma
-- se venden algunos de los mismos productos del mostrador, pero mas caros.
-- No son productos aparte: el familiar que sale por PedidosYa es el mismo
-- pote del mismo freezer, y tiene que descontar el mismo stock e insumos.
-- Por eso es otro tipo de precio del mismo producto, con el mismo historial
-- que el minorista. Que un producto tenga precio PEDIDOSYA vigente es lo que
-- lo pone en la carta de PedidosYa.

ALTER TABLE precios DROP CONSTRAINT precios_tipo_check;
ALTER TABLE precios
  ADD CONSTRAINT precios_tipo_check
    CHECK (tipo_precio IN ('MINORISTA', 'MAYORISTA_ENVASE_INCLUIDO', 'MAYORISTA_ENVASE_RETORNABLE', 'PEDIDOSYA'));

COMMENT ON COLUMN precios.tipo_precio IS
  'MINORISTA para la venta al público en el mostrador. PEDIDOSYA para la venta por la plataforma, que tiene su propia carta y sus propios precios: un producto está en esa carta si tiene precio PEDIDOSYA vigente. Los dos precios mayoristas se diferencian por el envase: ENVASE_INCLUIDO cuando el cliente se queda el tacho y lo paga, ENVASE_RETORNABLE cuando lo devuelve y por eso paga menos. No todo producto necesita todos los tipos.';

-- Down Migration

-- Los precios de PedidosYa se borran antes de volver a la regla vieja, que
-- no los admite. Las ventas no se pierden: cada linea guarda el precio que se
-- cobro (venta_detalle.precio_unitario_aplicado), no una referencia a precios.
DELETE FROM precios WHERE tipo_precio = 'PEDIDOSYA';

ALTER TABLE precios DROP CONSTRAINT precios_tipo_check;
ALTER TABLE precios
  ADD CONSTRAINT precios_tipo_check
    CHECK (tipo_precio IN ('MINORISTA', 'MAYORISTA_ENVASE_INCLUIDO', 'MAYORISTA_ENVASE_RETORNABLE'));

COMMENT ON COLUMN precios.tipo_precio IS
  'MINORISTA para la venta al público. Los dos precios mayoristas se diferencian por el envase: ENVASE_INCLUIDO cuando el cliente se queda el tacho y lo paga, ENVASE_RETORNABLE cuando lo devuelve y por eso paga menos. No todo producto necesita los tres tipos.';
