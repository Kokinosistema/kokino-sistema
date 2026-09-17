-- Up Migration

CREATE TABLE pagos_venta (
  id_pago_venta   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_venta        INTEGER NOT NULL REFERENCES ventas (id_venta) ON DELETE RESTRICT,
  id_medio_pago   INTEGER NOT NULL REFERENCES medios_pago (id_medio_pago) ON DELETE RESTRICT,
  id_caja         INTEGER REFERENCES cajas (id_caja) ON DELETE RESTRICT,
  id_usuario      INTEGER NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  monto           NUMERIC(12,2) NOT NULL,
  fecha_hora      TIMESTAMPTZ NOT NULL DEFAULT now(),
  referencia      VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pagos_venta_monto_check
    CHECK (monto > 0)
);

CREATE INDEX pagos_venta_id_venta_idx ON pagos_venta (id_venta);
CREATE INDEX pagos_venta_id_caja_idx ON pagos_venta (id_caja);
CREATE INDEX pagos_venta_id_medio_pago_idx ON pagos_venta (id_medio_pago);
CREATE INDEX pagos_venta_fecha_idx ON pagos_venta (fecha_hora);

CREATE TRIGGER trg_pagos_venta_set_updated_at
  BEFORE UPDATE ON pagos_venta
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE pagos_venta IS
  'Cobros de cada venta. Una venta puede tener varios pagos, sea porque se paga mitad en efectivo y mitad con tarjeta, o porque un mayorista la salda días después. La cuenta corriente no es un medio de pago: es una venta todavía sin pagos que la cubran, y lo que debe un cliente es la diferencia entre sus ventas y sus pagos.';
COMMENT ON COLUMN pagos_venta.id_caja IS
  'Caja donde entró la plata, que no es necesariamente la de la venta: si un mayorista compra el lunes y paga el viernes, el efectivo está en la caja del viernes y ahí tiene que contarse. Nulo solo cuando el dinero no pasó por ninguna caja, como una transferencia registrada fuera del horario de atención.';
COMMENT ON COLUMN pagos_venta.referencia IS
  'Número de operación de la tarjeta o la transferencia, para poder cruzarlo con el resumen bancario.';

-- Down Migration

DROP TABLE pagos_venta;
