-- Up Migration

-- Los envases familiares y diet vienen armados de fabrica con gustos fijos, asi
-- que cada combinacion y cada tamano es un producto distinto: es lo que el
-- cliente elige y lo que tiene precio y stock propio.
--
-- El diet de 250 cc se guarda como 0,250 litros en vez de agregar una unidad
-- aparte: el sistema ya mide volumen en litros y tener dos unidades para lo
-- mismo obliga a convertir en cada consulta. En pantalla puede mostrarse "250
-- cc"; el volumen guardado es el mismo.
--
-- Llevan stock propio porque se llenan con anticipacion y se guardan: hay
-- unidades que se pueden contar, a diferencia del termico que se arma al
-- momento sacando helado de un tacho del pozo.
INSERT INTO productos (nombre, id_categoria, tipo_origen, id_unidad_medida, contenido)
SELECT v.nombre, c.id_categoria, 'PRODUCIDO_DESDE_SABOR', u.id_unidad, v.contenido
  FROM (VALUES
    ('Familiar 3 lt americana, vainilla y dulce de leche', 'Familiar',    3.000),
    ('Familiar 5 lt americana, vainilla y dulce de leche', 'Familiar',    5.000),
    ('Familiar 3 lt chocolate, vainilla y dulce de leche', 'Familiar',    3.000),
    ('Familiar 5 lt chocolate, vainilla y dulce de leche', 'Familiar',    5.000),
    ('Familiar 3 lt chocolate, vainilla y frutilla',       'Familiar',    3.000),
    ('Familiar 5 lt chocolate, vainilla y frutilla',       'Familiar',    5.000),
    ('Diet 250 cc chocolate y vainilla',                   'Línea diet',  0.250),
    ('Diet 250 cc ananá y durazno',                        'Línea diet',  0.250),
    ('Diet 250 cc dulce de leche y frutilla',              'Línea diet',  0.250)
  ) AS v(nombre, categoria, contenido)
  JOIN categorias c ON c.nombre = v.categoria AND c.tipo = 'PRODUCTO'
  CROSS JOIN (SELECT id_unidad FROM unidades_medida WHERE abreviatura = 'lt') u;

-- Gustos con los que viene armado cada envase. El sabor se busca por nombre y
-- linea juntos porque el nombre solo no alcanza: "Vainilla" existe en artesanal
-- y en familiar, y son sabores distintos con recetas distintas.
INSERT INTO producto_sabores (id_producto, id_sabor)
SELECT p.id_producto, s.id_sabor
  FROM (VALUES
    ('Familiar 3 lt americana, vainilla y dulce de leche', 'Americana',      'FAMILIAR'),
    ('Familiar 3 lt americana, vainilla y dulce de leche', 'Vainilla',       'FAMILIAR'),
    ('Familiar 3 lt americana, vainilla y dulce de leche', 'Dulce de leche', 'FAMILIAR'),
    ('Familiar 5 lt americana, vainilla y dulce de leche', 'Americana',      'FAMILIAR'),
    ('Familiar 5 lt americana, vainilla y dulce de leche', 'Vainilla',       'FAMILIAR'),
    ('Familiar 5 lt americana, vainilla y dulce de leche', 'Dulce de leche', 'FAMILIAR'),

    ('Familiar 3 lt chocolate, vainilla y dulce de leche', 'Chocolate',      'FAMILIAR'),
    ('Familiar 3 lt chocolate, vainilla y dulce de leche', 'Vainilla',       'FAMILIAR'),
    ('Familiar 3 lt chocolate, vainilla y dulce de leche', 'Dulce de leche', 'FAMILIAR'),
    ('Familiar 5 lt chocolate, vainilla y dulce de leche', 'Chocolate',      'FAMILIAR'),
    ('Familiar 5 lt chocolate, vainilla y dulce de leche', 'Vainilla',       'FAMILIAR'),
    ('Familiar 5 lt chocolate, vainilla y dulce de leche', 'Dulce de leche', 'FAMILIAR'),

    ('Familiar 3 lt chocolate, vainilla y frutilla',       'Chocolate',      'FAMILIAR'),
    ('Familiar 3 lt chocolate, vainilla y frutilla',       'Vainilla',       'FAMILIAR'),
    ('Familiar 3 lt chocolate, vainilla y frutilla',       'Frutilla',       'FAMILIAR'),
    ('Familiar 5 lt chocolate, vainilla y frutilla',       'Chocolate',      'FAMILIAR'),
    ('Familiar 5 lt chocolate, vainilla y frutilla',       'Vainilla',       'FAMILIAR'),
    ('Familiar 5 lt chocolate, vainilla y frutilla',       'Frutilla',       'FAMILIAR'),

    ('Diet 250 cc chocolate y vainilla',        'Chocolate diet',      'ARTESANAL'),
    ('Diet 250 cc chocolate y vainilla',        'Vainilla diet',       'ARTESANAL'),
    ('Diet 250 cc ananá y durazno',             'Ananá diet',          'ARTESANAL'),
    ('Diet 250 cc ananá y durazno',             'Durazno diet',        'ARTESANAL'),
    ('Diet 250 cc dulce de leche y frutilla',   'Dulce de leche diet', 'ARTESANAL'),
    ('Diet 250 cc dulce de leche y frutilla',   'Frutilla diet',       'ARTESANAL')
  ) AS v(producto, sabor, linea)
  JOIN productos p ON p.nombre = v.producto
  JOIN sabores  s ON s.nombre = v.sabor AND s.linea = v.linea;

-- Down Migration

-- Borrar los productos se lleva sus gustos por el ON DELETE CASCADE de
-- producto_sabores. Falla si alguno ya fue vendido o movido de stock, por el
-- ON DELETE RESTRICT de esas tablas.
DELETE FROM productos
 WHERE nombre IN (
   'Familiar 3 lt americana, vainilla y dulce de leche',
   'Familiar 5 lt americana, vainilla y dulce de leche',
   'Familiar 3 lt chocolate, vainilla y dulce de leche',
   'Familiar 5 lt chocolate, vainilla y dulce de leche',
   'Familiar 3 lt chocolate, vainilla y frutilla',
   'Familiar 5 lt chocolate, vainilla y frutilla',
   'Diet 250 cc chocolate y vainilla',
   'Diet 250 cc ananá y durazno',
   'Diet 250 cc dulce de leche y frutilla'
 );
