-- Up Migration

-- ventas_mayorista_con_cliente_check exige que una venta mayorista tenga
-- cliente, pero no que ese cliente sea mayorista: entraba una venta mayorista
-- a nombre de un minorista, con precios de mayorista y sin cuenta corriente
-- habilitada.
--
-- Se resuelve con la misma FK compuesta que ya usan insumos contra categorias
-- y producto_sabores contra productos: el tipo viaja en la clave, asi que la
-- base solo encuentra pareja si coincide.
--
-- Queda ademas atado el caso inverso: una venta minorista tampoco puede ir a
-- nombre de un cliente mayorista. Si el revendedor se lleva un cucurucho para
-- el, es una venta de mostrador anonima, sin cliente asociado.
ALTER TABLE clientes ADD CONSTRAINT clientes_id_tipo_key UNIQUE (id_cliente, tipo_cliente);

ALTER TABLE ventas ADD CONSTRAINT ventas_cliente_del_tipo_fkey
  FOREIGN KEY (id_cliente, tipo_venta) REFERENCES clientes (id_cliente, tipo_cliente)
  ON DELETE RESTRICT;

COMMENT ON CONSTRAINT ventas_cliente_del_tipo_fkey ON ventas IS
  'El cliente tiene que ser del mismo tipo que la venta. Cuando no hay cliente, la venta de mostrador anonima, PostgreSQL no valida la clave foranea porque una de sus columnas es nula.';

-- Down Migration

ALTER TABLE ventas DROP CONSTRAINT ventas_cliente_del_tipo_fkey;
ALTER TABLE clientes DROP CONSTRAINT clientes_id_tipo_key;
