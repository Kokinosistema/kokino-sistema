-- Up Migration

-- Tipos de comprobante que emite Kokino, que es Responsable Inscripto.
--
-- El codigo AFIP es el numero oficial con el que hay que identificar cada tipo
-- al pedir autorizacion. Va nulo en el comprobante interno porque ese no es un
-- documento fiscal: es el ticket que se le da al cliente de mostrador que no
-- pide factura, y AFIP no lo conoce.
--
-- El signo permite sumar comprobantes sin preguntarse de que tipo son: una
-- factura suma y una nota de credito resta. Sin el, todo reporte de
-- facturacion tendria que acordarse de restar las notas a mano.
CREATE TABLE tipos_comprobante (
  id_tipo_comprobante  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre               VARCHAR(50) NOT NULL UNIQUE,
  codigo_afip          INTEGER UNIQUE,
  requiere_cae         BOOLEAN NOT NULL,
  signo                SMALLINT NOT NULL,
  activo               BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tipos_comprobante_signo_check
    CHECK (signo IN (1, -1)),
  -- Si lleva codigo AFIP es porque es fiscal, y todo comprobante fiscal
  -- necesita CAE. El interno no tiene ninguna de las dos cosas.
  CONSTRAINT tipos_comprobante_fiscal_coherente_check
    CHECK ((codigo_afip IS NOT NULL) = requiere_cae)
);

CREATE TRIGGER trg_tipos_comprobante_set_updated_at
  BEFORE UPDATE ON tipos_comprobante FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE tipos_comprobante IS
  'Comprobantes que puede emitir Kokino. Los codigos AFIP estan tomados de la tabla oficial y hay que verificarlos con el contador antes de conectar la facturacion electronica: un codigo equivocado hace que AFIP rechace el comprobante.';
COMMENT ON COLUMN tipos_comprobante.signo IS
  'Cuanto suma este comprobante a la facturacion: 1 la factura, -1 la nota de credito. Permite totalizar sin tener que acordarse de restar las notas.';

INSERT INTO tipos_comprobante (nombre, codigo_afip, requiere_cae, signo) VALUES
  ('Factura A',            1,    true,  1),
  ('Factura B',            6,    true,  1),
  ('Nota de crédito A',    3,    true, -1),
  ('Nota de crédito B',    8,    true, -1),
  ('Comprobante interno',  NULL, false, 1);

-- Alicuotas de IVA vigentes en Argentina, con su codigo AFIP. Se cargan todas
-- aunque hoy Kokino use una sola: son datos fiscales del pais, no del negocio,
-- y tenerlas evita una migracion el dia que aparezca un producto con otra.
CREATE TABLE alicuotas_iva (
  id_alicuota  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  descripcion  VARCHAR(20) NOT NULL UNIQUE,
  porcentaje   NUMERIC(5,2) NOT NULL UNIQUE,
  codigo_afip  INTEGER NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT alicuotas_iva_porcentaje_check
    CHECK (porcentaje >= 0 AND porcentaje <= 100)
);

CREATE TRIGGER trg_alicuotas_iva_set_updated_at
  BEFORE UPDATE ON alicuotas_iva FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE alicuotas_iva IS
  'Alicuotas de IVA con su codigo AFIP. Igual que los tipos de comprobante, los codigos hay que confirmarlos con el contador antes de facturar de verdad.';

INSERT INTO alicuotas_iva (descripcion, porcentaje, codigo_afip) VALUES
  ('0%',     0,    3),
  ('10,5%',  10.5, 4),
  ('21%',    21,   5),
  ('27%',    27,   6);

-- Down Migration

DROP TABLE alicuotas_iva;
DROP TABLE tipos_comprobante;
