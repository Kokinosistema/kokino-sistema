-- Up Migration

CREATE TABLE clientes (
  id_cliente               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre_razon_social      VARCHAR(200) NOT NULL,
  tipo_cliente             VARCHAR(20) NOT NULL,
  cuit                     VARCHAR(13) UNIQUE,
  telefono                 VARCHAR(30),
  direccion                VARCHAR(255),
  limite_cuenta_corriente  NUMERIC(12,2),
  plazo_pago_dias          INTEGER,
  activo                   BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clientes_tipo_cliente_check
    CHECK (tipo_cliente IN ('MINORISTA', 'MAYORISTA')),
  CONSTRAINT clientes_limite_positivo_check
    CHECK (limite_cuenta_corriente >= 0),
  CONSTRAINT clientes_plazo_positivo_check
    CHECK (plazo_pago_dias >= 0),
  CONSTRAINT clientes_cuenta_corriente_solo_mayorista_check
    CHECK (
      tipo_cliente = 'MAYORISTA'
      OR (limite_cuenta_corriente IS NULL AND plazo_pago_dias IS NULL)
    )
);

CREATE INDEX clientes_tipo_cliente_idx ON clientes (tipo_cliente);

CREATE TRIGGER trg_clientes_set_updated_at
  BEFORE UPDATE ON clientes
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE clientes IS
  'Clientes identificados. La venta minorista de mostrador es anónima y no genera cliente: solo se registran los mayoristas y los casos que hace falta identificar, como un pedido telefónico a domicilio.';
COMMENT ON COLUMN clientes.limite_cuenta_corriente IS
  'Tope de deuda permitido. Nulo significa que el cliente no tiene cuenta corriente habilitada, no que la tenga sin límite. A confirmar con los dueños si existen mayoristas sin tope.';
COMMENT ON COLUMN clientes.plazo_pago_dias IS
  'Días que tiene el mayorista para pagar una factura de cuenta corriente.';
COMMENT ON CONSTRAINT clientes_cuenta_corriente_solo_mayorista_check ON clientes IS
  'La cuenta corriente es exclusiva de los mayoristas: un minorista no puede tener límite ni plazo de pago cargados.';

-- Down Migration

DROP TABLE clientes;
