-- Up Migration

-- Orden de las categorias en la pantalla de Vender (pedido de la usuaria el
-- 2026-10-10): hasta ahora salian por nombre. Termicos va al lado de
-- Cucuruchos e Impulsivos queda al final. Una categoria nueva no trae orden
-- y aparece despues de estas, por nombre.

ALTER TABLE categorias ADD COLUMN orden INTEGER;

COMMENT ON COLUMN categorias.orden IS
  'Lugar de la categoria en la pantalla de Vender (menor, primero). Sin orden van al final, por nombre.';

UPDATE categorias c
   SET orden = v.orden
  FROM (VALUES
    ('Cafetería', 1),
    ('Cucuruchos', 2),
    ('Térmicos', 3),
    ('Familiar', 4),
    ('Línea diet', 5),
    ('Repostería', 6),
    ('Salsas', 7),
    ('Impulsivos', 8)
  ) AS v (nombre, orden)
 WHERE c.nombre = v.nombre AND c.tipo = 'PRODUCTO';

-- Down Migration

ALTER TABLE categorias DROP COLUMN orden;
