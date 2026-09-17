-- Up Migration

-- En Kokino a varias personas se las conoce solo por el nombre, duenos
-- incluidos. Exigir el apellido obligaba a inventarlo o a frenar el alta de
-- alguien que si trabaja ahi, y el sistema no lo usa para nada: quien hizo cada
-- operacion se resuelve por id_empleado, no por como se llama.
ALTER TABLE empleados
  ALTER COLUMN apellido DROP NOT NULL;

COMMENT ON COLUMN empleados.apellido IS
  'Opcional: en Kokino a varias personas se las conoce solo por el nombre. Conviene completarlo cuando se sepa, sobre todo en los dueños, que son los que aparecen en los reportes consolidados y del lado de la empresa cuando se integre AFIP.';

-- Down Migration

-- Falla a proposito si hay empleados sin apellido, que es lo que esta migracion
-- vino a permitir: habria que completarlos antes de volver a exigirlo.
ALTER TABLE empleados
  ALTER COLUMN apellido SET NOT NULL;

COMMENT ON COLUMN empleados.apellido IS NULL;
