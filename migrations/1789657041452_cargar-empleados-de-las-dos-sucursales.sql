-- Up Migration

-- El personal de cada local. No se cargan usuarios: crear una cuenta exige
-- guardar una contrasena hasheada, y eso lo hace la aplicacion cuando exista el
-- login. Inventar contrasenas provisorias ahora seria justo la forma en que
-- despues se filtran.
--
-- El DNI queda nulo a proposito: ningun proceso del sistema lo necesita y no
-- hace falta pedirle el documento a nadie para darlo de alta.
--
-- Falta Florencia, de Alem, que llego sin apellido, y faltan los duenos, que van
-- sin sucursal asignada porque no pertenecen a una sola.
INSERT INTO empleados (nombre, apellido, id_sucursal_asignada)
SELECT v.nombre, v.apellido, s.id_sucursal
  FROM (VALUES
    ('Eduardo',  'Campo',     'Entre Ríos'),
    ('David',    'Campo',     'Entre Ríos'),
    ('Franco',   'Sierra',    'Entre Ríos'),
    ('Nicolás',  'Escudero',  'Entre Ríos'),
    ('Abigail',  'Campos',    'Alem'),
    ('Martín',   'Trejo',     'Alem'),
    ('Claudio',  'Espinosa',  'Alem')
  ) AS v(nombre, apellido, sucursal)
  JOIN sucursales s ON s.nombre = v.sucursal;

-- Down Migration

-- Falla si algun empleado ya tiene cuenta de usuario o retiros de caja
-- asociados: no se borra una persona con historial.
DELETE FROM empleados
 WHERE (nombre, apellido) IN (
   ('Eduardo', 'Campo'), ('David', 'Campo'), ('Franco', 'Sierra'),
   ('Nicolás', 'Escudero'), ('Abigail', 'Campos'), ('Martín', 'Trejo'),
   ('Claudio', 'Espinosa')
 );
