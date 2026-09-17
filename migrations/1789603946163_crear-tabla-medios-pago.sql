-- Up Migration

CREATE TABLE medios_pago (
  id_medio_pago          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre                 VARCHAR(50) NOT NULL UNIQUE,
  afecta_caja_efectivo   BOOLEAN NOT NULL DEFAULT false,
  activo                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_medios_pago_set_updated_at
  BEFORE UPDATE ON medios_pago
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE medios_pago IS
  'Formas en que se cobra una venta. Es una tabla y no una lista fija porque los medios cambian solos con el tiempo, sobre todo las billeteras virtuales, y agregar uno no debería requerir tocar la estructura de la base.';
COMMENT ON COLUMN medios_pago.afecta_caja_efectivo IS
  'true solo para el efectivo. Es lo que permite calcular cuánta plata física debería haber al cerrar la caja: lo cobrado con tarjeta o por transferencia no está en el cajón.';
COMMENT ON COLUMN medios_pago.activo IS
  'false para dejar de ofrecer un medio sin borrarlo, así las ventas viejas que lo usaron siguen teniendo sentido.';

INSERT INTO medios_pago (nombre, afecta_caja_efectivo) VALUES
  ('Efectivo',           true),
  ('Débito',             false),
  ('Crédito',            false),
  ('Transferencia o QR', false);

-- Down Migration

DROP TABLE medios_pago;
