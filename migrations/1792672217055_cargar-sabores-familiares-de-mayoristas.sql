-- Up Migration

-- Sabores de la linea familiar que se venden a los mayoristas (confirmado por
-- la usuaria el 2026-10-22, a partir de la lista de precios del Sistema Rody:
-- la fabrica hace todos estos en la maquina familiar).
--
-- Cada familiar copia el nombre y la categoria de su version artesanal, que ya
-- estaba cargada: asi se nombran igual en las dos lineas y la categoria no se
-- inventa. La unica excepcion es Kinotos: el nombre correcto es "Kinotos al
-- wisky", asi que tambien se corrige el artesanal.
--
-- Quedan para otra migracion los que todavia hay que confirmar con los duenos:
-- Tentacion, Maracuya, Amargo, Higos al cognac, Cerezas a la crema, la
-- Frutilla familiar y Coco y dulce de leche.

UPDATE sabores SET nombre = 'Kinotos al wisky'
 WHERE nombre = 'Kinotos al whisky' AND linea = 'ARTESANAL';

INSERT INTO sabores (nombre, id_categoria, linea)
SELECT a.nombre, a.id_categoria, 'FAMILIAR'
  FROM (VALUES
    ('Ananá'), ('Durazno'), ('Limón'), ('Frutilla al agua'),
    ('Ananá al champagne'), ('Arándanos'),

    ('Banana split'), ('Frutos del bosque'), ('Mousse de limón'), ('Melón'),
    ('Kinotos al wisky'),

    ('Chocolate blanco'), ('Chocolate a la cubana'), ('Chocolate con almendras'),
    ('Bombón Rocher'),

    ('Flan al caramelo'), ('Granizado'), ('Crema del cielo'), ('Menta granizada'),
    ('Crema Kokino'), ('Kokicukis'), ('Almendrado'), ('Chocotorta'),
    ('Crema oriental'), ('Sambayón'),

    ('Dulce de leche granizado'), ('Dulce de leche goloso'), ('Dulce de leche con nuez')
  ) AS v(nombre)
  JOIN sabores a ON a.nombre = v.nombre AND a.linea = 'ARTESANAL';

-- El JOIN de arriba descarta en silencio un nombre mal escrito: se controla
-- que hayan entrado los 28, y si no, la migracion entera se deshace.
DO $$
BEGIN
  IF (SELECT count(*) FROM sabores WHERE linea = 'FAMILIAR' AND nombre IN (
        'Ananá', 'Durazno', 'Limón', 'Frutilla al agua', 'Ananá al champagne', 'Arándanos',
        'Banana split', 'Frutos del bosque', 'Mousse de limón', 'Melón', 'Kinotos al wisky',
        'Chocolate blanco', 'Chocolate a la cubana', 'Chocolate con almendras', 'Bombón Rocher',
        'Flan al caramelo', 'Granizado', 'Crema del cielo', 'Menta granizada', 'Crema Kokino',
        'Kokicukis', 'Almendrado', 'Chocotorta', 'Crema oriental', 'Sambayón',
        'Dulce de leche granizado', 'Dulce de leche goloso', 'Dulce de leche con nuez')) <> 28 THEN
    RAISE EXCEPTION 'No se cargaron los 28 sabores familiares: revisar que cada nombre exista en la linea artesanal';
  END IF;
END;
$$;

-- Down Migration

-- Falla si algun sabor ya tiene lotes o tachos, por el ON DELETE RESTRICT: no
-- se borra un sabor con historial.
DELETE FROM sabores
 WHERE linea = 'FAMILIAR'
   AND nombre IN (
     'Ananá', 'Durazno', 'Limón', 'Frutilla al agua', 'Ananá al champagne', 'Arándanos',
     'Banana split', 'Frutos del bosque', 'Mousse de limón', 'Melón', 'Kinotos al wisky',
     'Chocolate blanco', 'Chocolate a la cubana', 'Chocolate con almendras', 'Bombón Rocher',
     'Flan al caramelo', 'Granizado', 'Crema del cielo', 'Menta granizada', 'Crema Kokino',
     'Kokicukis', 'Almendrado', 'Chocotorta', 'Crema oriental', 'Sambayón',
     'Dulce de leche granizado', 'Dulce de leche goloso', 'Dulce de leche con nuez'
   );

UPDATE sabores SET nombre = 'Kinotos al whisky'
 WHERE nombre = 'Kinotos al wisky' AND linea = 'ARTESANAL';
