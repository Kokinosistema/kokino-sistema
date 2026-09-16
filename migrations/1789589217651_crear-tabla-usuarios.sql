-- Up Migration

CREATE TABLE usuarios (
  id_usuario     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_empleado    INTEGER NOT NULL UNIQUE REFERENCES empleados (id_empleado) ON DELETE CASCADE,
  id_rol         INTEGER NOT NULL REFERENCES roles (id_rol) ON DELETE RESTRICT,
  username       VARCHAR(50) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX usuarios_id_rol_idx ON usuarios (id_rol);

CREATE TRIGGER trg_usuarios_set_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE usuarios IS
  'Cuentas de acceso al sistema. Cada empleado con acceso tiene su propia cuenta individual; las cuentas nunca se comparten entre personas.';
COMMENT ON COLUMN usuarios.id_empleado IS
  'Empleado dueño de la cuenta. UNIQUE: un empleado no puede tener dos cuentas.';
COMMENT ON COLUMN usuarios.password_hash IS
  'Hash de la contraseña (Argon2id o bcrypt). NUNCA se guarda la contraseña en texto plano. Ancho 255 para admitir cualquiera de los dos algoritmos.';
COMMENT ON COLUMN usuarios.activo IS
  'false suspende el acceso al sistema sin borrar la cuenta ni su historial de operaciones.';

-- Down Migration

DROP TABLE usuarios;
