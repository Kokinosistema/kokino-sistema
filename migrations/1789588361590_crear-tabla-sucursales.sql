-- Up Migration

CREATE TABLE sucursales (
  id_sucursal        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre             VARCHAR(100) NOT NULL UNIQUE,
  direccion          VARCHAR(255),
  telefono           VARCHAR(30),
  tiene_fabrica      BOOLEAN NOT NULL DEFAULT false,
  punto_venta_afip   INTEGER,
  horario_apertura   TIME,
  horario_cierre     TIME,
  activa             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Regla de negocio actual: Kokino tiene una única fábrica. Este índice único
-- parcial impide que se marquen dos sucursales con tiene_fabrica = true al
-- mismo tiempo, sin bloquear que existan sucursales con tiene_fabrica = false.
CREATE UNIQUE INDEX sucursales_una_fabrica_uidx
  ON sucursales (tiene_fabrica)
  WHERE tiene_fabrica = true;

-- El punto de venta AFIP debe ser único cuando está cargado, pero puede
-- quedar en NULL hasta que se integre la facturación electrónica.
CREATE UNIQUE INDEX sucursales_punto_venta_afip_uidx
  ON sucursales (punto_venta_afip)
  WHERE punto_venta_afip IS NOT NULL;

CREATE TRIGGER trg_sucursales_set_updated_at
  BEFORE UPDATE ON sucursales
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE sucursales IS
  'Locales de venta de Kokino. Una de ellas también aloja la fábrica de producción (tiene_fabrica = true).';
COMMENT ON COLUMN sucursales.tiene_fabrica IS
  'true si en este local funciona además la fábrica de producción. Solo una sucursal puede tenerlo en true (ver sucursales_una_fabrica_uidx).';
COMMENT ON COLUMN sucursales.punto_venta_afip IS
  'Número de punto de venta fiscal asignado por AFIP para esta sucursal. Nulo hasta integrar la facturación electrónica.';
COMMENT ON COLUMN sucursales.activa IS
  'false si la sucursal fue dada de baja operativamente, sin borrar su historial.';

-- Down Migration

DROP TABLE sucursales;
