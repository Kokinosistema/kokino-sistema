-- Up Migration

-- En la hoja COSTOS el insumo figura solo como "Leche", pero las recetas lo
-- escriben "Leche en polvo" y los duenos confirmaron que siempre usan en
-- polvo. El precio lo respalda: seis mil pesos el kilo no es leche liquida.
-- Se renombra ahora, antes de que las recetas empiecen a referenciarlo, para
-- que el nombre en la base diga lo que de verdad se compra.
UPDATE insumos SET nombre = 'Leche en polvo' WHERE nombre = 'Leche';

-- Down Migration

UPDATE insumos SET nombre = 'Leche' WHERE nombre = 'Leche en polvo';
