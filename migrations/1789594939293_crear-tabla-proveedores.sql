-- Up Migration

CREATE TABLE proveedores (
  id_proveedor            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  razon_social            VARCHAR(200) NOT NULL UNIQUE,
  cuit                    VARCHAR(13),
  telefono                VARCHAR(30),
  plazo_pago              VARCHAR(20),
  forma_pago_habitual     VARCHAR(30),
  datos_cuenta_bancaria   VARCHAR(255),
  observaciones           TEXT,
  activo                  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT proveedores_plazo_pago_check
    CHECK (plazo_pago IN ('CONTADO', '30_DIAS', 'FIADO')),
  CONSTRAINT proveedores_forma_pago_check
    CHECK (forma_pago_habitual IN ('EFECTIVO', 'DEPOSITO_BANCARIO', 'RAPIPAGO'))
);

CREATE UNIQUE INDEX proveedores_cuit_uidx
  ON proveedores (cuit)
  WHERE cuit IS NOT NULL;

CREATE TRIGGER trg_proveedores_set_updated_at
  BEFORE UPDATE ON proveedores
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE proveedores IS
  'Empresas y personas a las que Kokino le compra insumos.';
COMMENT ON COLUMN proveedores.cuit IS
  'CUIT del proveedor, necesario para registrar facturas de compra. Nulo mientras no se haya cargado.';
COMMENT ON COLUMN proveedores.plazo_pago IS
  'Cuándo se le paga: CONTADO al recibir, 30_DIAS a plazo acordado, FIADO sin plazo fijo (se paga cuando el proveedor pasa a cobrar).';
COMMENT ON COLUMN proveedores.forma_pago_habitual IS
  'Cómo se le paga habitualmente. Es el medio de costumbre, no una restricción: un pago puntual puede hacerse por otra vía.';
COMMENT ON COLUMN proveedores.datos_cuenta_bancaria IS
  'CBU o alias para transferencias. Dato sensible: no debe exponerse en pantallas ni reportes de uso general.';

-- Down Migration

DROP TABLE proveedores;
