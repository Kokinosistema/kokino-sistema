-- Up Migration

-- El tipo SABOR existia en categorias desde hace varias migraciones pero no
-- habia ninguna cargada. Estas son las agrupaciones reales con las que Kokino
-- ordena sus sabores.
--
-- Los frutales van como dos categorias separadas y no como una con
-- subdivisiones, porque categorias es una lista plana por decision de diseno. La
-- distincion entre agua y crema es real (los de agua no llevan lacteos, tienen
-- otra densidad y sirven para quien no toma leche), y con pocas categorias una
-- jerarquia cuesta mas de lo que resuelve: "todos los frutales" se consulta
-- pidiendo las dos.
INSERT INTO categorias (nombre, tipo) VALUES
  ('Frutales al agua',   'SABOR'),
  ('Frutales a la crema','SABOR'),
  ('Chocolate',          'SABOR'),
  ('Cremas',             'SABOR'),
  ('Dulce de leche',     'SABOR');

-- Down Migration

-- Falla si ya hay sabores en estas categorias, por el ON DELETE RESTRICT de la
-- FK: no se borra una categoria que todavia agrupa algo.
DELETE FROM categorias
 WHERE tipo = 'SABOR'
   AND nombre IN ('Frutales al agua', 'Frutales a la crema', 'Chocolate', 'Cremas', 'Dulce de leche');
