-- Up Migration

-- Reposteria que Kokino compra hecha y revende. Convive en la categoria
-- Reposteria con las tortas y alfajores de produccion propia: lo que las
-- distingue es tipo_origen, no la categoria, asi que un reporte puede verlas
-- juntas o separadas segun convenga.
INSERT INTO productos (nombre, id_categoria, tipo_origen, id_unidad_medida, contenido, lleva_stock_propio)
SELECT v.nombre, c.id_categoria, 'COMPRADO_TERMINADO', u.id_unidad, v.contenido, true
  FROM (VALUES
          ('Chocotorta',                           1),
          ('Lemon curd',                           1),
          ('Rogel',                                1),
          ('Brownie',                              1),
          ('Leche condensada',                     1),
          ('Crumble de manzana',                   1),
          ('Chocotorta pequeña',                   1),
          ('Lemon curd pequeño',                   1),
          ('Brownie con nuez pequeño',             1),
          ('Tarta de leche condensada pequeña',    1),
          ('Crumble de manzana pequeño',           1),
          ('Coco y dulce de leche',                1),
          ('Cheesecake pequeño',                   1),
          ('Galletas choco',                       1),
          ('Alfajor grande',                       1),
          ('Brownie con merengue',                 1),
          ('Volcán',                               1),
          ('Rogel chico',                          1),
          -- El paquete trae cinco alfajores: el contenido lo dice para que el
          -- sistema sepa que vender uno saca cinco unidades del deposito.
          ('Alfajores x 5',                        5)
       ) AS v(nombre, contenido)
 CROSS JOIN categorias c
 CROSS JOIN unidades_medida u
 WHERE c.nombre = 'Repostería' AND c.tipo = 'PRODUCTO'
   AND u.abreviatura = 'un';

-- Estos dos no se compran armados: se compra el brownie o el volcan y el
-- helado se sirve en el momento de servirlo. Por eso no tienen stock propio
-- (no hay brownies con helado esperando en una heladera) y su origen es
-- PRODUCIDO_DIRECTO: lo que se descuenta al venderlos es la pieza comprada,
-- que se define mas adelante en producto_insumos. El helado no se descuenta,
-- por la misma decision que en las tortas.
INSERT INTO productos (nombre, id_categoria, tipo_origen, id_unidad_medida, contenido, lleva_stock_propio)
SELECT v.nombre, c.id_categoria, 'PRODUCIDO_DIRECTO', u.id_unidad, 1, false
  FROM (VALUES ('Brownie con helado'), ('Volcán con helado')) AS v(nombre)
 CROSS JOIN categorias c
 CROSS JOIN unidades_medida u
 WHERE c.nombre = 'Repostería' AND c.tipo = 'PRODUCTO'
   AND u.abreviatura = 'un';

-- Down Migration

DELETE FROM productos WHERE nombre IN (
  'Chocotorta', 'Lemon curd', 'Rogel', 'Brownie', 'Leche condensada',
  'Crumble de manzana', 'Chocotorta pequeña', 'Lemon curd pequeño',
  'Brownie con nuez pequeño', 'Tarta de leche condensada pequeña',
  'Crumble de manzana pequeño', 'Coco y dulce de leche', 'Cheesecake pequeño',
  'Galletas choco', 'Alfajor grande', 'Brownie con merengue', 'Volcán',
  'Rogel chico', 'Alfajores x 5', 'Brownie con helado', 'Volcán con helado'
);
