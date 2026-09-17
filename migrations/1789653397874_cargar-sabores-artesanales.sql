-- Up Migration

-- Los 43 sabores de la linea artesanal de Kokino.
--
-- Los nombres de chocolate y dulce de leche se guardan completos ("Chocolate
-- clasico" y no "Clasico") por dos motivos: el nombre es unico dentro de cada
-- linea y "Clasico" existia en los dos grupos, y ademas el nombre aparece solo
-- en pantallas de stock y en tickets, donde "Clasico" no le dice nada a nadie.
--
-- densidad_kg_por_litro, kg_por_tina y prioridad_produccion quedan nulos: Kokino
-- todavia no los tiene medidos ni clasificados. Sin densidad no se puede
-- fraccionar un lote en tachos, asi que es un pendiente a cerrar antes de
-- empezar a producir por sistema.
INSERT INTO sabores (nombre, id_categoria, linea)
SELECT v.nombre, c.id_categoria, 'ARTESANAL'
  FROM (VALUES
    ('Ananá',                  'Frutales al agua'),
    ('Ananá al champagne',     'Frutales al agua'),
    ('Durazno',                'Frutales al agua'),
    ('Frutilla al agua',       'Frutales al agua'),
    ('Limón',                  'Frutales al agua'),
    ('Arándanos',              'Frutales al agua'),
    ('Citrus',                 'Frutales al agua'),

    ('Banana dolce',           'Frutales a la crema'),
    ('Banana split',           'Frutales a la crema'),
    ('Frutilla a la crema',    'Frutales a la crema'),
    ('Cereza al maraschino',   'Frutales a la crema'),
    ('Higos al cognac',        'Frutales a la crema'),
    ('Kinotos al whisky',      'Frutales a la crema'),
    ('Frutos del bosque',      'Frutales a la crema'),
    ('Melón',                  'Frutales a la crema'),
    ('Mousse de limón',        'Frutales a la crema'),

    ('Chocolate clásico',      'Chocolate'),
    ('Chocolate a la cubana',  'Chocolate'),
    ('Chocolate amargo',       'Chocolate'),
    ('Chocolate blanco',       'Chocolate'),
    ('Chocolate con almendras','Chocolate'),
    ('Chocolate tentación',    'Chocolate'),
    ('Bombón Rocher',          'Chocolate'),

    ('Mousse de maracuyá',     'Cremas'),
    ('Vainilla',               'Cremas'),
    ('Americana',              'Cremas'),
    ('Crema del cielo',        'Cremas'),
    ('Crema Kokino',           'Cremas'),
    ('Kokicukis',              'Cremas'),
    ('Crema oriental',         'Cremas'),
    ('Flan al caramelo',       'Cremas'),
    ('Almendrado',             'Cremas'),
    ('Granizado',              'Cremas'),
    ('Sambayón',               'Cremas'),
    ('Menta granizada',        'Cremas'),
    ('Chocotorta',             'Cremas'),
    ('Pistacho',               'Cremas'),
    ('Crema irlandesa',        'Cremas'),
    ('Chocolate Dubai',        'Cremas'),

    ('Dulce de leche clásico',   'Dulce de leche'),
    ('Dulce de leche granizado', 'Dulce de leche'),
    ('Dulce de leche con nuez',  'Dulce de leche'),
    ('Dulce de leche goloso',    'Dulce de leche')
  ) AS v(nombre, categoria)
  JOIN categorias c
    ON c.nombre = v.categoria
   AND c.tipo = 'SABOR';

-- Down Migration

-- Falla si algun sabor ya fue usado en una receta o en una produccion, por el
-- ON DELETE RESTRICT: no se borra un sabor con historial.
DELETE FROM sabores
 WHERE linea = 'ARTESANAL'
   AND nombre IN (
     'Ananá', 'Ananá al champagne', 'Durazno', 'Frutilla al agua', 'Limón',
     'Arándanos', 'Citrus',
     'Banana dolce', 'Banana split', 'Frutilla a la crema', 'Cereza al maraschino',
     'Higos al cognac', 'Kinotos al whisky', 'Frutos del bosque', 'Melón',
     'Mousse de limón',
     'Chocolate clásico', 'Chocolate a la cubana', 'Chocolate amargo',
     'Chocolate blanco', 'Chocolate con almendras', 'Chocolate tentación',
     'Bombón Rocher',
     'Mousse de maracuyá', 'Vainilla', 'Americana', 'Crema del cielo',
     'Crema Kokino', 'Kokicukis', 'Crema oriental', 'Flan al caramelo',
     'Almendrado', 'Granizado', 'Sambayón', 'Menta granizada', 'Chocotorta',
     'Pistacho', 'Crema irlandesa', 'Chocolate Dubai',
     'Dulce de leche clásico', 'Dulce de leche granizado',
     'Dulce de leche con nuez', 'Dulce de leche goloso'
   );
