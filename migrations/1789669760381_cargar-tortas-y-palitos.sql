-- Up Migration

-- Los palitos son productos de impulso y los duenos los miran aparte de la
-- reposteria, asi que llevan categoria propia. La categoria queda abierta para
-- que mas adelante entren ahi otros impulsivos, como el bombon escoces.
INSERT INTO categorias (nombre, tipo) VALUES ('Impulsivos', 'PRODUCTO');

-- Primeros productos PRODUCIDO_DIRECTO del sistema: a diferencia de los
-- termicos y familiares, que solo se arman con helado ya hecho, estos tienen
-- receta propia con insumos comprados (galletas, crema, almendras, chocolate).
--
-- El helado que llevan no se descuenta ni se registra, por decision de negocio:
-- se produce en la casa y no falta, y lo que hace falta controlar es el insumo
-- comprado que si se puede acabar. El stock de helado no pierde exactitud por
-- esto, porque un tacho no se descuenta por calculo sino cuando alguien lo ve
-- vacio: si las tortas lo gastan, se vacia antes y se marca antes.
--
-- lleva_stock_propio en true porque se hacen por tanda y se guardan en el
-- freezer hasta venderse, asi que se cuentan por unidad.
INSERT INTO productos (nombre, id_categoria, tipo_origen, id_unidad_medida, contenido, lleva_stock_propio)
SELECT v.nombre, c.id_categoria, 'PRODUCIDO_DIRECTO', u.id_unidad, 1, true
  FROM (VALUES
          ('Torta súper dulce de leche',        'Repostería'),
          ('Torta chocolatosa',                 'Repostería'),
          ('Torta frutos rojos',                'Repostería'),
          ('Torta chocolate blanco y maracuyá', 'Repostería'),
          ('Palito frutal limón',               'Impulsivos'),
          ('Palito frutal frutilla',            'Impulsivos'),
          ('Palito frutal ananá',               'Impulsivos'),
          ('Palito de crema americana',         'Impulsivos'),
          ('Palito de crema vainilla',          'Impulsivos'),
          ('Palito bombón',                     'Impulsivos')
       ) AS v(nombre, categoria)
  JOIN categorias c ON c.nombre = v.categoria AND c.tipo = 'PRODUCTO'
 CROSS JOIN unidades_medida u
 WHERE u.abreviatura = 'un';

-- Down Migration

DELETE FROM productos
 WHERE nombre IN (
   'Torta súper dulce de leche', 'Torta chocolatosa', 'Torta frutos rojos',
   'Torta chocolate blanco y maracuyá', 'Palito frutal limón',
   'Palito frutal frutilla', 'Palito frutal ananá', 'Palito de crema americana',
   'Palito de crema vainilla', 'Palito bombón'
 );

DELETE FROM categorias WHERE nombre = 'Impulsivos' AND tipo = 'PRODUCTO';
