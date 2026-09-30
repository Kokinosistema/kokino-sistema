-- Up Migration

-- Lo que se arma al vender (un cono, un termico, un cafe) no tiene stock
-- propio: lo que se cuenta es el cucurucho, el envase o el cafe que se gasta.
-- Se cargan como insumos y se conectan con cada producto, asi cada venta
-- descuenta lo suyo del stock de la sucursal.
--
-- Datos definidos con la usuaria el 2026-09-30:
--   - el Cono simple y el Cono americano llevan el mismo cucurucho;
--   - el Mini cucuruchon y el Cucuruchon doble, tambien;
--   - el resto de los cucuruchos y vasos, y cada termico, lleva el suyo;
--   - el cafe se compra en bolsas de medio kilo y se cuenta en kilos: cada
--     bolsa es 0,5 kg, y lo que gasta cada cafe lo cargan los duenos en
--     gramos, que no es un dato que se sepa todavia;
--   - el "Jarrito y alfajor" lleva un alfajor que no es el que se vende
--     suelto: es un insumo propio del combo.
-- Los nombres de los insumos son una propuesta; se pueden cambiar desde la
-- pantalla Insumos sin tocar nada mas.

INSERT INTO insumos (nombre, id_categoria, id_unidad_medida)
SELECT n.nombre, c.id_categoria, u.id_unidad
  FROM (VALUES
    ('Cucurucho simple',          'Cucuruchos', 'un'),
    ('Cucuruchón',                'Cucuruchos', 'un'),
    ('Cucurucho triple',          'Cucuruchos', 'un'),
    ('Barquillo',                 'Cucuruchos', 'un'),
    ('Vasito',                    'Cucuruchos', 'un'),
    ('Vaso',                      'Cucuruchos', 'un'),
    ('Envase térmico 1 kg',       'Térmicos',   'un'),
    ('Envase térmico 1/2 kg',     'Térmicos',   'un'),
    ('Envase térmico 1/4 kg',     'Térmicos',   'un'),
    ('Café (bolsas de 1/2 kg)',   'Cafetería',  'kg'),
    ('Alfajor para el café',      'Cafetería',  'un')
  ) AS n (nombre, categoria, unidad)
  JOIN categorias c ON c.nombre = n.categoria AND c.tipo = 'INSUMO'
  JOIN unidades_medida u ON u.abreviatura = n.unidad;

-- Cada producto descuenta una unidad de su insumo por cada una vendida. El
-- cafe no se conecta todavia: cuantos gramos lleva cada cafe lo cargan los
-- duenos desde la pantalla del producto.
INSERT INTO producto_insumos (id_producto, id_insumo, cantidad, id_unidad_medida)
SELECT p.id_producto, i.id_insumo, 1, i.id_unidad_medida
  FROM (VALUES
    ('Cono simple',       'Cucurucho simple'),
    ('Cono americano',    'Cucurucho simple'),
    ('Mini cucuruchón',   'Cucuruchón'),
    ('Cucuruchón doble',  'Cucuruchón'),
    ('Cono triple',       'Cucurucho triple'),
    ('Barquillo',         'Barquillo'),
    ('Vasito',            'Vasito'),
    ('Vaso',              'Vaso'),
    ('Térmico 1 kg',      'Envase térmico 1 kg'),
    ('Térmico 1/2 kg',    'Envase térmico 1/2 kg'),
    ('Térmico 1/4 kg',    'Envase térmico 1/4 kg'),
    ('Jarrito y alfajor', 'Alfajor para el café')
  ) AS c (producto, insumo)
  JOIN productos p ON p.nombre = c.producto
  JOIN insumos i ON i.nombre = c.insumo;

-- Si algun nombre no coincidio (un producto renombrado, un acento distinto),
-- el JOIN lo habria salteado sin avisar. Mejor frenar la migracion.
DO $$
BEGIN
  IF (SELECT count(*) FROM insumos WHERE nombre IN (
        'Cucurucho simple', 'Cucuruchón', 'Cucurucho triple', 'Barquillo', 'Vasito', 'Vaso',
        'Envase térmico 1 kg', 'Envase térmico 1/2 kg', 'Envase térmico 1/4 kg',
        'Café (bolsas de 1/2 kg)', 'Alfajor para el café')) <> 11 THEN
    RAISE EXCEPTION 'No se cargaron los 11 insumos: revisar los nombres de categorias y unidades';
  END IF;
  IF (SELECT count(*) FROM producto_insumos pi JOIN insumos i USING (id_insumo) WHERE i.nombre IN (
        'Cucurucho simple', 'Cucuruchón', 'Cucurucho triple', 'Barquillo', 'Vasito', 'Vaso',
        'Envase térmico 1 kg', 'Envase térmico 1/2 kg', 'Envase térmico 1/4 kg',
        'Alfajor para el café')) <> 12 THEN
    RAISE EXCEPTION 'No se conectaron los 12 productos con su insumo: revisar los nombres de los productos';
  END IF;
END $$;

-- Down Migration

DELETE FROM producto_insumos
 WHERE id_insumo IN (SELECT id_insumo FROM insumos WHERE nombre IN (
   'Cucurucho simple', 'Cucuruchón', 'Cucurucho triple', 'Barquillo', 'Vasito', 'Vaso',
   'Envase térmico 1 kg', 'Envase térmico 1/2 kg', 'Envase térmico 1/4 kg',
   'Café (bolsas de 1/2 kg)', 'Alfajor para el café'));

-- Si ya se vendio algo, los movimientos de stock nombran a estos insumos y
-- el borrado falla: en ese caso no hay que revertir, sino corregir hacia
-- adelante.
DELETE FROM insumos WHERE nombre IN (
  'Cucurucho simple', 'Cucuruchón', 'Cucurucho triple', 'Barquillo', 'Vasito', 'Vaso',
  'Envase térmico 1 kg', 'Envase térmico 1/2 kg', 'Envase térmico 1/4 kg',
  'Café (bolsas de 1/2 kg)', 'Alfajor para el café');
