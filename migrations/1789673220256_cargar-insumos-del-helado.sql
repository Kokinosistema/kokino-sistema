-- Up Migration

-- Los 46 ingredientes de la planilla de formulaciones artesanales. Los nombres
-- vienen normalizados: en la planilla estan abreviados de forma despareja
-- (estab chant, DL heladero, Choc para grani) y eso complicaria cruzarlos con
-- las recetas, donde los mismos ingredientes aparecen escritos completos.
-- Tambien se corrigen tres errores de tipeo del original: crocrante,
-- biscochuelo y cerezzas.
--
-- Todos entran como materia prima por ahora. Algunos, como el bizcochuelo o
-- las galletas, podrian moverse despues a reposteria si los duenos los miran
-- por separado; cambiar de categoria es una migracion chica.
INSERT INTO insumos (nombre, id_categoria, id_unidad_medida, perecedero)
SELECT v.nombre, c.id_categoria, u.id_unidad, false
  FROM (VALUES
          ('Azúcar','kg'),                  ('Leche','kg'),
          ('Crema de leche','kg'),          ('Neutro','kg'),
          ('Agente de batido','kg'),        ('Estabilizante chantilly','kg'),
          ('Estabilizante vainilla','kg'),  ('Estabilizante chocolate','kg'),
          ('Estabilizante mousse','kg'),    ('Estabilizante almendra','kg'),
          ('Estabilizante de banana','kg'), ('Dulce de leche heladero','kg'),
          ('Dulce de leche repostero','kg'),('Pulpa de frutilla','kg'),
          ('Pulpa de ananá','kg'),          ('Pulpa de durazno','kg'),
          ('Pasta de vainilla','kg'),       ('Pasta de melón','kg'),
          ('Pasta de sambayón','kg'),       ('Pasta de arándanos','kg'),
          ('Pasta de maracuyá','kg'),       ('Nutelina base','kg'),
          ('Mapcol base','kg'),             ('Chocolate para granizar','kg'),
          ('Variegato de frutos rojos','kg'),('Cobertura amarga','kg'),
          ('Cobertura blanca','kg'),        ('Cacao','kg'),
          ('Nueces','kg'),                  ('Almendras','kg'),
          ('Pasas','kg'),                   ('Coco','kg'),
          ('Galletitas micro','kg'),        ('Galletas Chocolinas','kg'),
          ('Bizcochuelo','kg'),             ('Crocante','kg'),
          ('Granulado blanco','kg'),        ('Banana','kg'),
          ('Limón','kg'),                   ('Cerezas','kg'),
          ('Kinotos','kg'),                 ('Higos','kg'),
          ('Champagne','kg'),               ('Oreo','paq'),
          ('Licor seco','bot'),             ('Maraschino','bot')
       ) AS v(nombre, unidad)
 CROSS JOIN categorias c
  JOIN unidades_medida u ON u.abreviatura = v.unidad
 WHERE c.nombre = 'Materia prima' AND c.tipo = 'INSUMO';

-- Down Migration

DELETE FROM insumos WHERE id_categoria = (
  SELECT id_categoria FROM categorias WHERE nombre = 'Materia prima' AND tipo = 'INSUMO'
);
