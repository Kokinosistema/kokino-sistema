-- Up Migration

-- Las dos sucursales reales de Kokino. Van por migracion y no por un script de
-- carga aparte porque sin ellas el sistema no funciona: son parte de la
-- instalacion, como las unidades de medida o los medios de pago.
INSERT INTO sucursales (nombre, direccion, telefono, tiene_fabrica) VALUES
  ('Entre Ríos', 'Entre Ríos 604',      '3816103791', true),
  ('Alem',       'Av. Alem y Lavalle',  '4200947',    false);

-- Los dos locales abren igual: 10:00 todos los dias, cierran a las 00:00 de
-- lunes a viernes y a la 01:00 sabados y domingos. generate_series arma los 7
-- dias y el CROSS JOIN los combina con las dos sucursales: 14 filas sin
-- escribirlas a mano ni repetir el horario catorce veces.
INSERT INTO sucursal_horarios (id_sucursal, dia_semana, hora_apertura, hora_cierre)
SELECT s.id_sucursal,
       d.dia_semana,
       TIME '10:00',
       CASE WHEN d.dia_semana <= 5 THEN TIME '00:00' ELSE TIME '01:00' END
  FROM sucursales s
  CROSS JOIN generate_series(1, 7) AS d(dia_semana)
 WHERE s.nombre IN ('Entre Ríos', 'Alem');

COMMENT ON COLUMN sucursales.punto_venta_afip IS
  'Número de punto de venta fiscal asignado por AFIP para esta sucursal. Nulo en las dos: todavía no se pidieron, se cargan al integrar la facturación electrónica.';

-- Down Migration

-- Borrar las sucursales se lleva sus horarios por el ON DELETE CASCADE. Si para
-- entonces ya hay ventas, cajas o tachos colgando de ellas, el DELETE falla por
-- las FK con ON DELETE RESTRICT, que es lo que se espera: no se borra una
-- sucursal con historial operativo.
DELETE FROM sucursales WHERE nombre IN ('Entre Ríos', 'Alem');

COMMENT ON COLUMN sucursales.punto_venta_afip IS
  'Número de punto de venta fiscal asignado por AFIP para esta sucursal. Nulo hasta integrar la facturación electrónica.';
