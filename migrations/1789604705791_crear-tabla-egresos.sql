-- Up Migration

CREATE TABLE egresos (
  id_egreso      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_caja        INTEGER NOT NULL REFERENCES cajas (id_caja) ON DELETE RESTRICT,
  id_medio_pago  INTEGER NOT NULL REFERENCES medios_pago (id_medio_pago) ON DELETE RESTRICT,
  id_usuario     INTEGER NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  id_empleado    INTEGER REFERENCES empleados (id_empleado) ON DELETE RESTRICT,
  tipo_egreso    VARCHAR(30) NOT NULL,
  monto          NUMERIC(12,2) NOT NULL,
  descripcion    TEXT,
  fecha_hora     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT egresos_tipo_check
    CHECK (tipo_egreso IN ('SERVICIO', 'COMPRA', 'RETIRO_EMPLEADO', 'OTRO')),
  CONSTRAINT egresos_monto_check
    CHECK (monto > 0),
  CONSTRAINT egresos_empleado_solo_en_retiro_check
    CHECK (id_empleado IS NULL OR tipo_egreso = 'RETIRO_EMPLEADO')
);

CREATE INDEX egresos_id_caja_idx ON egresos (id_caja);
CREATE INDEX egresos_id_medio_pago_idx ON egresos (id_medio_pago);
CREATE INDEX egresos_id_empleado_idx ON egresos (id_empleado);
CREATE INDEX egresos_fecha_idx ON egresos (fecha_hora);

CREATE TRIGGER trg_egresos_set_updated_at
  BEFORE UPDATE ON egresos
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE egresos IS
  'Plata que sale durante un turno: servicios, compras chicas y retiros de empleados a cuenta de sueldo. Se llama egresos y no egresos_caja porque también se registran los pagados por transferencia o tarjeta, que no salen del cajón; el medio de pago es el que define cuáles afectan el arqueo.';
COMMENT ON COLUMN egresos.monto IS
  'Siempre positivo. Que sea una salida ya lo dice la tabla, así que no se usa signo negativo: mezclarlo con los cobros positivos invitaría a sumar mal.';
COMMENT ON COLUMN egresos.id_empleado IS
  'Empleado que retiró la plata, solo en los retiros a cuenta de sueldo. Se registra quién se la llevó, pero el sistema no acumula un saldo de sueldo por persona: la liquidación es de RRHH y quedó fuera de alcance.';
COMMENT ON COLUMN egresos.id_usuario IS
  'Quién cargó el egreso en el sistema, que no es lo mismo que el empleado que retiró la plata.';

-- Down Migration

DROP TABLE egresos;
