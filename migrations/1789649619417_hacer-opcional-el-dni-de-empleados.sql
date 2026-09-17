-- Up Migration

-- Ningun proceso del sistema lee el DNI: los empleados se referencian por
-- id_empleado y los usuarios entran con su nombre de usuario. RRHH y sueldos
-- quedaron fuera de alcance, asi que exigirlo era pedir un dato personal que
-- nadie usa. Guardar datos personales de mas es un riesgo y no una precaucion:
-- la Ley 25.326 pide recolectar lo minimo necesario para la finalidad.
ALTER TABLE empleados
  ALTER COLUMN dni DROP NOT NULL;

-- El UNIQUE se mantiene y sigue sirviendo: PostgreSQL trata cada nulo como
-- distinto de los demas, asi que puede haber muchos empleados sin DNI sin que
-- choquen, pero dos DNI reales iguales se siguen rechazando.
COMMENT ON COLUMN empleados.dni IS
  'DNI como texto: puede tener ceros a la izquierda y nunca se opera aritméticamente con él. Opcional, porque ningún proceso del sistema lo necesita: se carga solo si hace falta identificar formalmente a la persona, por ejemplo para cruzar los retiros a cuenta de sueldo con el sistema de sueldos que los dueños llevan aparte.';

-- Down Migration

-- Falla a proposito si hay empleados sin DNI, que es justamente lo que esta
-- migracion vino a permitir: habria que decidir que DNI ponerles antes de poder
-- volver a exigirlo.
ALTER TABLE empleados
  ALTER COLUMN dni SET NOT NULL;

COMMENT ON COLUMN empleados.dni IS
  'DNI como texto: puede tener ceros a la izquierda y nunca se opera aritméticamente con él.';
