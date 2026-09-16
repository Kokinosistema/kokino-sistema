-- Up Migration

-- Función reutilizable que todas las tablas del sistema van a usar en un
-- trigger BEFORE UPDATE para mantener su columna updated_at sincronizada
-- automáticamente, sin depender de que la aplicación la actualice a mano.
CREATE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_updated_at() IS
  'Trigger function: fija updated_at = now() en cada UPDATE de fila. Se usa en un trigger BEFORE UPDATE por tabla.';

-- Down Migration

DROP FUNCTION set_updated_at();
