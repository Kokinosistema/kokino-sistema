-- Up Migration

CREATE TABLE roles (
  id_rol       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre_rol   VARCHAR(50) NOT NULL UNIQUE,
  descripcion  VARCHAR(255),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_roles_set_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE roles IS
  'Roles de acceso al sistema. Hoy son solo 2: administrador y encargado_local (vendedores y personal de producción no tienen usuario propio).';

INSERT INTO roles (nombre_rol, descripcion) VALUES
  ('administrador', 'Dueños del negocio. Acceso a todas las sucursales y a la fábrica.'),
  ('encargado_local', 'Responsable de una sucursal: atiende ventas, carga stock y, en la sucursal con fábrica, carga las producciones diarias.');

-- Down Migration

DROP TABLE roles;
