-- Up Migration

-- El bano va a la categoria Salsas por decision de negocio: los duenos lo
-- miran junto con las salsas embotelladas. Eso ensancha lo que significa la
-- categoria respecto de como se creo en
-- 1789733631955_cargar-salsas-embotelladas: ya no es "envasado para llevar",
-- es "cobertura dulce", se venda en botella o servida sobre el helado. Se
-- aclara aca y no se corrige alla porque las migraciones aplicadas no se
-- reescriben.
--
-- A diferencia de las salsas, el bano no se vende envasado: se sirve cuando
-- alguien pide un helado. Por eso lleva_stock_propio va en false, igual que
-- 'Brownie con helado' o 'Volcan con helado': no hay unidades que contar en el
-- freezer, se arma al momento de vender.
--
-- Va como producto propio y no como atributo del helado porque se cobra
-- aparte: tiene su precio y tiene que poder aparecer como linea de la venta.
--
-- Contenido 1 'un' porque la unidad de venta es la porcion servida, que no se
-- pesa. Lo que se gasta de chocolate se controla contando el insumo, igual que
-- el helado a peso.
--
-- Pendiente decidido el 2026-09-18: por ahora NO descuenta insumo al venderse.
-- El dia que lo quieran, se carga una fila en producto_insumos contra el
-- insumo 'Chocolate para granizar' con los gramos que lleva cada bano, y el
-- trigger de descuento que ya existe se encarga del resto. No hace falta
-- migrar estructura para eso.
INSERT INTO productos (nombre, id_categoria, tipo_origen, id_unidad_medida, contenido, lleva_stock_propio)
SELECT 'Baño de chocolate', c.id_categoria, 'PRODUCIDO_DIRECTO', u.id_unidad, 1, false
  FROM categorias c
 CROSS JOIN unidades_medida u
 WHERE c.nombre = 'Salsas' AND c.tipo = 'PRODUCTO'
   AND u.abreviatura = 'un';

-- Down Migration

DELETE FROM productos WHERE nombre = 'Baño de chocolate';
