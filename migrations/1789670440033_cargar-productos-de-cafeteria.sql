-- Up Migration

-- La cafeteria se prepara recien cuando el cliente la pide, asi que
-- lleva_stock_propio queda en false: no hay cafes contados esperando en una
-- heladera. Lo que si hay que controlar es el cafe en grano, los vasos y el
-- azucar, que se compran y se acaban; eso lo resuelve producto_insumos, que
-- descuenta esos insumos al vender.
--
-- El affogato lleva helado y el combo lleva un alfajor comprado. El helado no
-- se descuenta, por la misma decision que en las tortas; el alfajor si, porque
-- es mercaderia comprada que se puede acabar.
INSERT INTO productos (nombre, id_categoria, tipo_origen, id_unidad_medida, contenido, lleva_stock_propio)
SELECT v.nombre, c.id_categoria, 'PRODUCIDO_DIRECTO', u.id_unidad, 1, false
  FROM (VALUES
          ('Café chico'),
          ('Jarrito'),
          ('Jarrito y alfajor'),
          ('Affogato')
       ) AS v(nombre)
 CROSS JOIN categorias c
 CROSS JOIN unidades_medida u
 WHERE c.nombre = 'Cafetería' AND c.tipo = 'PRODUCTO'
   AND u.abreviatura = 'un';

-- Down Migration

DELETE FROM productos
 WHERE nombre IN ('Café chico', 'Jarrito', 'Jarrito y alfajor', 'Affogato');
