-- Up Migration

-- Rita y Rodolfo son los duenos. Van sin sucursal asignada porque no trabajan
-- fijos en un local: se mueven entre los dos.
--
-- Que sean duenos no se guarda aca. La sucursal dice donde trabaja la persona;
-- el nivel de acceso vive en el rol de su cuenta de usuario, que se va a crear
-- cuando exista el login. Son dos cosas independientes: un dueno que ademas
-- atiende un mostrador tendria sucursal asignada igual.
INSERT INTO empleados (nombre, id_sucursal_asignada) VALUES
  ('Rita',    NULL),
  ('Rodolfo', NULL);

INSERT INTO empleados (nombre, id_sucursal_asignada)
SELECT 'Florencia', s.id_sucursal
  FROM sucursales s WHERE s.nombre = 'Alem';

-- Down Migration

DELETE FROM empleados
 WHERE apellido IS NULL
   AND nombre IN ('Rita', 'Rodolfo', 'Florencia');
