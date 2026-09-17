-- Up Migration

CREATE TABLE ventas (
  id_venta              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_caja               INTEGER NOT NULL REFERENCES cajas (id_caja) ON DELETE RESTRICT,
  id_usuario            INTEGER NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  id_cliente            INTEGER REFERENCES clientes (id_cliente) ON DELETE RESTRICT,
  fecha_hora            TIMESTAMPTZ NOT NULL DEFAULT now(),
  canal_venta           VARCHAR(20) NOT NULL,
  tipo_venta            VARCHAR(20) NOT NULL,
  id_usuario_anulacion  INTEGER REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  fecha_anulacion       TIMESTAMPTZ,
  motivo_anulacion      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ventas_canal_check
    CHECK (canal_venta IN ('MOSTRADOR', 'TELEFONO', 'PEDIDOSYA')),
  CONSTRAINT ventas_tipo_check
    CHECK (tipo_venta IN ('MINORISTA', 'MAYORISTA')),
  CONSTRAINT ventas_mayorista_con_cliente_check
    CHECK (tipo_venta = 'MINORISTA' OR id_cliente IS NOT NULL),
  CONSTRAINT ventas_anulacion_completa_check
    CHECK (num_nonnulls(id_usuario_anulacion, fecha_anulacion) IN (0, 2)),
  CONSTRAINT ventas_anulacion_posterior_check
    CHECK (fecha_anulacion IS NULL OR fecha_anulacion >= fecha_hora)
);

CREATE INDEX ventas_id_caja_idx ON ventas (id_caja);
CREATE INDEX ventas_id_cliente_idx ON ventas (id_cliente);
CREATE INDEX ventas_id_usuario_idx ON ventas (id_usuario);
CREATE INDEX ventas_fecha_hora_idx ON ventas (fecha_hora);
CREATE INDEX ventas_canal_idx ON ventas (canal_venta);

CREATE TRIGGER trg_ventas_set_updated_at
  BEFORE UPDATE ON ventas
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE ventas IS
  'Cabecera de cada venta. No guarda la sucursal, porque la caja ya la determina, ni el total, que es la suma de su detalle.';
COMMENT ON COLUMN ventas.canal_venta IS
  'Por dónde entró la venta. PEDIDOSYA se separa de TELEFONO en vez de agruparlos como delivery porque la plataforma cobra comisión, y conviene poder aislar esas ventas en los reportes.';
COMMENT ON COLUMN ventas.id_cliente IS
  'Nulo en la venta de mostrador, que es anónima. Obligatorio en la mayorista: hace falta saber a quién facturarle y a quién cobrarle si queda a cuenta.';
COMMENT ON COLUMN ventas.fecha_anulacion IS
  'Una venta mal cargada no se borra: se anula dejando registro de quién y cuándo. Borrarla haría desaparecer plata de la caja sin explicación y rompería la numeración de comprobantes. No hay columna de estado: la venta está anulada si tiene fecha de anulación.';

-- Down Migration

DROP TABLE ventas;
