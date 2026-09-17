-- Up Migration

-- La linea diet es una linea comercial, no una maquina: se hace en la misma
-- maquina que el artesanal, solo que con una formula baja en azucares. Por eso
-- entra como categoria de sabor y sus sabores llevan linea ARTESANAL, que es la
-- columna que guarda en que maquina se produce.
INSERT INTO categorias (nombre, tipo) VALUES ('Diet', 'SABOR');

-- Sabores de la linea familiar. Son filas propias y no las artesanales del mismo
-- nombre porque la maquina familiar incorpora mas aire: misma denominacion, otra
-- receta, otra densidad y otro costo. La frutilla va en frutales a la crema
-- porque acompana a chocolate y vainilla en el envase.
INSERT INTO sabores (nombre, id_categoria, linea)
SELECT v.nombre, c.id_categoria, 'FAMILIAR'
  FROM (VALUES
    ('Americana',      'Cremas'),
    ('Vainilla',       'Cremas'),
    ('Dulce de leche', 'Dulce de leche'),
    ('Chocolate',      'Chocolate'),
    ('Frutilla',       'Frutales a la crema')
  ) AS v(nombre, categoria)
  JOIN categorias c ON c.nombre = v.categoria AND c.tipo = 'SABOR';

-- Sabores diet. Llevan "diet" en el nombre porque el nombre es unico dentro de
-- cada linea y estos comparten linea ARTESANAL con los comunes: sin el sufijo,
-- la vainilla diet chocaria con la vainilla artesanal. Ademas es como se los
-- nombra en el mostrador.
INSERT INTO sabores (nombre, id_categoria, linea)
SELECT v.nombre, c.id_categoria, 'ARTESANAL'
  FROM (VALUES
    ('Chocolate diet',      'Diet'),
    ('Vainilla diet',       'Diet'),
    ('Ananá diet',          'Diet'),
    ('Durazno diet',        'Diet'),
    ('Dulce de leche diet', 'Diet'),
    ('Frutilla diet',       'Diet')
  ) AS v(nombre, categoria)
  JOIN categorias c ON c.nombre = v.categoria AND c.tipo = 'SABOR';

-- Down Migration

DELETE FROM sabores
 WHERE linea = 'FAMILIAR'
   AND nombre IN ('Americana', 'Vainilla', 'Dulce de leche', 'Chocolate', 'Frutilla');

DELETE FROM sabores
 WHERE linea = 'ARTESANAL'
   AND nombre IN ('Chocolate diet', 'Vainilla diet', 'Ananá diet', 'Durazno diet',
                  'Dulce de leche diet', 'Frutilla diet');

DELETE FROM categorias WHERE tipo = 'SABOR' AND nombre = 'Diet';
