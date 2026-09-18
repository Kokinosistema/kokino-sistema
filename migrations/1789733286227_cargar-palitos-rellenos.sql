-- Up Migration

-- Los palitos rellenos son una linea aparte de los de crema, no un reemplazo:
-- los de crema se siguen vendiendo a $4000 y estos valen $7000. Coinciden en
-- dos gustos (vainilla y americana), asi que el nombre tiene que decir de que
-- linea es cada uno: "Palito de crema vainilla" y "Palito relleno vainilla"
-- son dos productos distintos que conviven en la carta.
--
-- Van a Impulsivos con los demas palitos y no a Reposteria: la categoria
-- existe justamente para los productos de impulso, que los duenos miran
-- aparte.
--
-- Mismo tratamiento que los otros palitos: PRODUCIDO_DIRECTO porque se hacen
-- en la casa, y lleva_stock_propio en true porque se arman por tanda y se
-- guardan en el freezer hasta venderse, asi que se cuentan por unidad.
INSERT INTO productos (nombre, id_categoria, tipo_origen, id_unidad_medida, contenido, lleva_stock_propio)
SELECT v.nombre, c.id_categoria, 'PRODUCIDO_DIRECTO', u.id_unidad, 1, true
  FROM (VALUES
          ('Palito relleno dulce de leche'),
          ('Palito relleno vainilla'),
          ('Palito relleno americana')
       ) AS v(nombre)
 CROSS JOIN categorias c
 CROSS JOIN unidades_medida u
 WHERE c.nombre = 'Impulsivos' AND c.tipo = 'PRODUCTO'
   AND u.abreviatura = 'un';

-- Down Migration

DELETE FROM productos
 WHERE nombre IN (
   'Palito relleno dulce de leche',
   'Palito relleno vainilla',
   'Palito relleno americana'
 );
