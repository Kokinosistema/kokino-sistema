-- Up Migration

-- Alfajores que hace la cocina, en tres sabores. Se producen por tanda y se
-- guardan hasta venderse, asi que llevan stock propio y se cuentan por unidad.
--
-- Ojo al leer la base mas adelante: van a convivir dos cosas llamadas alfajor.
-- Estas tres son PRODUCTOS de produccion propia que se venden sueltos. Aparte
-- existe un alfajor COMPRADO, que es un insumo y solo aparece adentro del
-- combo "Jarrito y alfajor". No son lo mismo ni se descuentan del mismo lugar.
INSERT INTO productos (nombre, id_categoria, tipo_origen, id_unidad_medida, contenido, lleva_stock_propio)
SELECT v.nombre, c.id_categoria, 'PRODUCIDO_DIRECTO', u.id_unidad, 1, true
  FROM (VALUES
          ('Alfajor marroc'),
          ('Alfajor chocolate blanco con nuez'),
          ('Alfajor chocolate')
       ) AS v(nombre)
 CROSS JOIN categorias c
 CROSS JOIN unidades_medida u
 WHERE c.nombre = 'Repostería' AND c.tipo = 'PRODUCTO'
   AND u.abreviatura = 'un';

-- Down Migration

DELETE FROM productos
 WHERE nombre IN ('Alfajor marroc', 'Alfajor chocolate blanco con nuez', 'Alfajor chocolate');
