-- Up Migration

-- Las salsas embotelladas no entran en ninguna categoria existente: no se
-- comen en el local como los impulsivos ni son un postre como la reposteria,
-- se llevan a la casa. Van a categoria propia para que en los reportes se vean
-- aparte, y queda abierta por si mas adelante venden otros envasados para
-- llevar (granas, banos de chocolate).
INSERT INTO categorias (nombre, tipo) VALUES ('Salsas', 'PRODUCTO');

-- COMPRADO_TERMINADO: Kokino las compra ya embotelladas, no las produce. Por
-- eso no llevan receta; el dia que quieran ver el margen, el costo va en
-- costos_producto como el de la reposteria comprada.
--
-- El tamano va en contenido y no solo en el nombre, igual que en los termicos
-- y los diet: guardado como numero el sistema puede comparar precio por kilo
-- entre la de 200 y las de 500, y con el nombre solo habria que salir a
-- interpretar texto para eso. Se expresa en kilos y no en gramos para no
-- inventar una unidad distinta a la que ya usa el resto del catalogo.
INSERT INTO productos (nombre, id_categoria, tipo_origen, id_unidad_medida, contenido, lleva_stock_propio)
SELECT v.nombre, c.id_categoria, 'COMPRADO_TERMINADO', u.id_unidad, v.contenido, true
  FROM (VALUES
          ('Salsa de chocolate x200g', 0.200),
          ('Salsa de frutilla x500g',  0.500),
          ('Salsa de caramelo x500g',  0.500)
       ) AS v(nombre, contenido)
 CROSS JOIN categorias c
 CROSS JOIN unidades_medida u
 WHERE c.nombre = 'Salsas' AND c.tipo = 'PRODUCTO'
   AND u.abreviatura = 'kg';

-- Down Migration

DELETE FROM productos
 WHERE nombre IN (
   'Salsa de chocolate x200g',
   'Salsa de frutilla x500g',
   'Salsa de caramelo x500g'
 );

DELETE FROM categorias WHERE nombre = 'Salsas' AND tipo = 'PRODUCTO';
