-- Up Migration

CREATE TABLE empleados (
  id_empleado           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre                VARCHAR(100) NOT NULL,
  apellido              VARCHAR(100) NOT NULL,
  dni                   VARCHAR(15) NOT NULL UNIQUE,
  telefono              VARCHAR(30),
  fecha_ingreso         DATE,
  id_sucursal_asignada  INTEGER REFERENCES sucursales (id_sucursal) ON DELETE RESTRICT,
  activo                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX empleados_id_sucursal_asignada_idx
  ON empleados (id_sucursal_asignada);

CREATE TRIGGER trg_empleados_set_updated_at
  BEFORE UPDATE ON empleados
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE empleados IS
  'Personas que trabajan en Kokino. No todos tienen acceso al sistema: solo quienes tengan una fila en usuarios.';
COMMENT ON COLUMN empleados.dni IS
  'DNI como texto: puede tener ceros a la izquierda y nunca se opera aritméticamente con él.';
COMMENT ON COLUMN empleados.id_sucursal_asignada IS
  'Sucursal donde trabaja el empleado. Nulo para los dueños/administradores, que no pertenecen a una sucursal específica.';
COMMENT ON COLUMN empleados.activo IS
  'false si el empleado ya no trabaja en Kokino, sin borrar su historial de operaciones.';

-- Down Migration

DROP TABLE empleados;
