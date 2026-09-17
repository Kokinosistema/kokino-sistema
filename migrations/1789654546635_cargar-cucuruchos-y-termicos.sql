-- Up Migration

-- Cucuruchos y termicos se sirven en el mostrador con los gustos que elige el
-- cliente, asi que no tienen fila en producto_sabores: los gustos no quedan
-- registrados, solo la cantidad vendida.
--
-- Ninguno lleva stock propio: se arman en el momento sacando helado de un tacho
-- del pozo, y ese helado ya lo cuenta la tabla tachos. Descontarlos tambien como
-- producto seria contar el mismo helado dos veces.
--
-- Los cucuruchos van con contenido 1 unidad y no en kilos porque nadie pesa
-- cuanto helado entra en un cono, y varia. Que un cono triple lleve mas que uno
-- simple queda expresado en el nombre y en el precio; poner un peso inventado
-- seria meter un numero falso que despues aparece en un reporte.
INSERT INTO productos (nombre, id_categoria, tipo_origen, id_unidad_medida, contenido, lleva_stock_propio)
SELECT v.nombre, c.id_categoria, 'PRODUCIDO_DESDE_SABOR', u.id_unidad, v.contenido, false
  FROM (VALUES
    ('Cono simple',      'Cucuruchos', 'un', 1.000),
    ('Mini cucuruchón',  'Cucuruchos', 'un', 1.000),
    ('Cono americano',   'Cucuruchos', 'un', 1.000),
    ('Vasito',           'Cucuruchos', 'un', 1.000),
    ('Vaso',             'Cucuruchos', 'un', 1.000),
    ('Cucuruchón doble', 'Cucuruchos', 'un', 1.000),
    ('Cono triple',      'Cucuruchos', 'un', 1.000),
    ('Barquillo',        'Cucuruchos', 'un', 1.000),

    ('Térmico 1/4 kg',   'Térmicos',   'kg', 0.250),
    ('Térmico 1/2 kg',   'Térmicos',   'kg', 0.500),
    ('Térmico 1 kg',     'Térmicos',   'kg', 1.000)
  ) AS v(nombre, categoria, unidad, contenido)
  JOIN categorias c ON c.nombre = v.categoria AND c.tipo = 'PRODUCTO'
  JOIN unidades_medida u ON u.abreviatura = v.unidad;

-- Down Migration

DELETE FROM productos
 WHERE nombre IN (
   'Cono simple', 'Mini cucuruchón', 'Cono americano', 'Vasito', 'Vaso',
   'Cucuruchón doble', 'Cono triple', 'Barquillo',
   'Térmico 1/4 kg', 'Térmico 1/2 kg', 'Térmico 1 kg'
 );
