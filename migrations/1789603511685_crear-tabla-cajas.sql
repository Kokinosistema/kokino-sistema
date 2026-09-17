-- Up Migration

CREATE TABLE cajas (
  id_caja                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_sucursal             INTEGER NOT NULL REFERENCES sucursales (id_sucursal) ON DELETE RESTRICT,
  turno                   VARCHAR(10) NOT NULL,
  id_usuario_apertura     INTEGER NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  fecha_apertura          TIMESTAMPTZ NOT NULL DEFAULT now(),
  monto_apertura          NUMERIC(12,2) NOT NULL,
  id_usuario_cierre       INTEGER REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  fecha_cierre            TIMESTAMPTZ,
  monto_cierre_declarado  NUMERIC(12,2),
  monto_cierre_sistema    NUMERIC(12,2),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cajas_turno_check
    CHECK (turno IN ('MANANA', 'TARDE', 'NOCHE')),
  CONSTRAINT cajas_monto_apertura_check
    CHECK (monto_apertura >= 0),
  CONSTRAINT cajas_montos_cierre_check
    CHECK (monto_cierre_declarado >= 0 AND monto_cierre_sistema >= 0),
  CONSTRAINT cajas_cierre_completo_check
    CHECK (num_nonnulls(id_usuario_cierre, fecha_cierre, monto_cierre_declarado, monto_cierre_sistema) IN (0, 4)),
  CONSTRAINT cajas_cierre_posterior_check
    CHECK (fecha_cierre IS NULL OR fecha_cierre > fecha_apertura)
);

-- Una sola caja abierta por sucursal a la vez: no se puede abrir la del turno
-- siguiente sin haber cerrado la anterior.
CREATE UNIQUE INDEX cajas_una_abierta_por_sucursal_uidx
  ON cajas (id_sucursal)
  WHERE fecha_cierre IS NULL;

CREATE INDEX cajas_id_sucursal_fecha_idx ON cajas (id_sucursal, fecha_apertura);
CREATE INDEX cajas_id_usuario_apertura_idx ON cajas (id_usuario_apertura);

CREATE TRIGGER trg_cajas_set_updated_at
  BEFORE UPDATE ON cajas
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE cajas IS
  'Aperturas y cierres de caja. Cada turno abre contando la plata con la que arranca y cierra con el arqueo. No hay columna de estado: la caja está abierta mientras no tenga fecha de cierre.';
COMMENT ON COLUMN cajas.turno IS
  'MANANA, TARDE o NOCHE. El código va sin eñe a propósito: es un valor interno, no un texto para mostrar en pantalla.';
COMMENT ON COLUMN cajas.monto_cierre_declarado IS
  'Plata que se contó físicamente al cerrar.';
COMMENT ON COLUMN cajas.monto_cierre_sistema IS
  'Lo que el sistema calculaba que debía haber en ese momento: apertura más cobros en efectivo menos egresos. Es una de las pocas cosas derivadas que sí se guardan, porque es la foto contra la que se hizo el arqueo: si mañana se corrige una venta vieja, el cálculo daría otro número y el faltante de aquel día desaparecería del historial, aunque haya ocurrido.';
COMMENT ON CONSTRAINT cajas_cierre_completo_check ON cajas IS
  'Los cuatro datos del cierre van juntos: o la caja está abierta y los cuatro son nulos, o está cerrada y están los cuatro. Evita una caja a medio cerrar.';

-- Down Migration

DROP TABLE cajas;
