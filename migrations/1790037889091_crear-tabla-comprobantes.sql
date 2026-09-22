-- Up Migration

CREATE TABLE comprobantes (
  id_comprobante           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_venta                 INTEGER NOT NULL REFERENCES ventas (id_venta) ON DELETE RESTRICT,
  id_tipo_comprobante      INTEGER NOT NULL REFERENCES tipos_comprobante (id_tipo_comprobante) ON DELETE RESTRICT,
  id_alicuota_iva          INTEGER REFERENCES alicuotas_iva (id_alicuota) ON DELETE RESTRICT,
  id_comprobante_origen    INTEGER REFERENCES comprobantes (id_comprobante) ON DELETE RESTRICT,
  punto_venta              INTEGER NOT NULL,
  numero                   INTEGER NOT NULL,
  neto                     NUMERIC(12,2) NOT NULL,
  iva                      NUMERIC(12,2) NOT NULL,
  total                    NUMERIC(12,2) NOT NULL,
  cae                      VARCHAR(20),
  vencimiento_cae          DATE,
  fecha_emision            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comprobantes_importes_check
    CHECK (neto >= 0 AND iva >= 0 AND total >= 0),
  CONSTRAINT comprobantes_total_coherente_check
    CHECK (total = neto + iva),
  CONSTRAINT comprobantes_numero_check
    CHECK (numero > 0),
  CONSTRAINT comprobantes_cae_completo_check
    CHECK (num_nonnulls(cae, vencimiento_cae) IN (0, 2))
);

-- AFIP no admite dos comprobantes con el mismo tipo, punto de venta y numero.
-- La base lo impide en vez de confiar en que la aplicacion lleve bien la
-- cuenta: un numero repetido es un comprobante rechazado.
CREATE UNIQUE INDEX comprobantes_numeracion_uidx
  ON comprobantes (id_tipo_comprobante, punto_venta, numero);

-- El CAE tambien es unico: AFIP no autoriza dos veces el mismo.
CREATE UNIQUE INDEX comprobantes_cae_uidx
  ON comprobantes (cae) WHERE cae IS NOT NULL;

CREATE INDEX comprobantes_id_venta_idx ON comprobantes (id_venta);
CREATE INDEX comprobantes_fecha_emision_idx ON comprobantes (fecha_emision);
CREATE INDEX comprobantes_id_comprobante_origen_idx ON comprobantes (id_comprobante_origen);

CREATE TRIGGER trg_comprobantes_set_updated_at
  BEFORE UPDATE ON comprobantes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE comprobantes IS
  'Comprobantes emitidos. No hay uno solo por venta: una venta facturada que despues se anula lleva la factura y ademas la nota de credito que la cancela, porque AFIP no permite borrar una factura emitida. Y una venta de mostrador que no pidio factura puede no tener ninguno, o solo un comprobante interno.';
COMMENT ON COLUMN comprobantes.punto_venta IS
  'Punto de venta fiscal con el que se emitio, copiado de la sucursal al momento de emitir y no leido de ella despues. Si a la sucursal le cambiaran el punto de venta, los comprobantes viejos tienen que seguir diciendo el numero con el que realmente se emitieron.';
COMMENT ON COLUMN comprobantes.neto IS
  'Importes tal como se declararon a AFIP. Se guardan aunque el total de la venta se pueda calcular, porque un comprobante es una declaracion congelada: si despues se corrige una linea de la venta, lo que ya se envio a AFIP no cambia.';
COMMENT ON COLUMN comprobantes.cae IS
  'Codigo de autorizacion que devuelve AFIP. Nulo mientras el comprobante esta pendiente de autorizar, que pasa si se corta la conexion; el comprobante interno nunca lo lleva porque no es fiscal.';
COMMENT ON COLUMN comprobantes.id_comprobante_origen IS
  'Factura que cancela esta nota de credito. AFIP exige que la nota indique a que comprobante corresponde.';

-- Down Migration

DROP TABLE comprobantes;
