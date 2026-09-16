-- Up Migration

CREATE TABLE movimientos_insumo (
  id_movimiento_insumo  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_insumo             INTEGER NOT NULL REFERENCES insumos (id_insumo) ON DELETE RESTRICT,
  id_sucursal           INTEGER NOT NULL REFERENCES sucursales (id_sucursal) ON DELETE RESTRICT,
  tipo_movimiento       VARCHAR(30) NOT NULL,
  cantidad              NUMERIC(14,3) NOT NULL,
  id_produccion         INTEGER REFERENCES produccion (id_produccion) ON DELETE RESTRICT,
  id_usuario            INTEGER NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  fecha_hora            TIMESTAMPTZ NOT NULL DEFAULT now(),
  observaciones         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT movimientos_insumo_tipo_check
    CHECK (tipo_movimiento IN ('ENTRADA_COMPRA', 'CONSUMO_PRODUCCION', 'AJUSTE')),
  CONSTRAINT movimientos_insumo_cantidad_no_cero_check
    CHECK (cantidad <> 0),
  CONSTRAINT movimientos_insumo_signo_check
    CHECK (
      (tipo_movimiento = 'ENTRADA_COMPRA' AND cantidad > 0)
      OR (tipo_movimiento = 'CONSUMO_PRODUCCION' AND cantidad < 0)
      OR tipo_movimiento = 'AJUSTE'
    ),
  CONSTRAINT movimientos_insumo_produccion_coherente_check
    CHECK ((tipo_movimiento = 'CONSUMO_PRODUCCION') = (id_produccion IS NOT NULL))
);

-- Índice pensado para la consulta central: cuánto hay de un insumo en una
-- sucursal, que es sumar la cantidad de todas sus filas.
CREATE INDEX movimientos_insumo_stock_idx ON movimientos_insumo (id_insumo, id_sucursal);
CREATE INDEX movimientos_insumo_fecha_idx ON movimientos_insumo (fecha_hora);
CREATE INDEX movimientos_insumo_id_produccion_idx ON movimientos_insumo (id_produccion);
CREATE INDEX movimientos_insumo_id_usuario_idx ON movimientos_insumo (id_usuario);

CREATE TRIGGER trg_movimientos_insumo_set_updated_at
  BEFORE UPDATE ON movimientos_insumo
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE movimientos_insumo IS
  'Libro de entradas y salidas de insumos. No existe una columna con el stock actual: el stock de un insumo en una sucursal es la suma de sus movimientos, así nunca queda un saldo pisado o desactualizado. El helado no está acá: se cuenta por tachos.';
COMMENT ON COLUMN movimientos_insumo.tipo_movimiento IS
  'Los insumos solo entran por compra, se consumen en producción o se ajustan. No se venden ni se trasladan entre sucursales, porque cada sucursal le compra lo suyo a sus proveedores.';
COMMENT ON COLUMN movimientos_insumo.cantidad IS
  'Cantidad con signo, siempre en la unidad de compra del insumo. Positiva si entra, negativa si sale. Si la receta lo expresa en otra unidad de la misma magnitud, se convierte antes de registrar el movimiento.';
COMMENT ON COLUMN movimientos_insumo.id_produccion IS
  'Producción que consumió el insumo. Es una FK real y no un número suelto, para que la base pueda validar que la producción referenciada existe.';
COMMENT ON COLUMN movimientos_insumo.observaciones IS
  'Texto libre, sobre todo para explicar un ajuste. No hay lista de motivos: hoy en Kokino no existen categorías definidas de ajuste, y ponerlas sería inventarlas.';
COMMENT ON CONSTRAINT movimientos_insumo_signo_check ON movimientos_insumo IS
  'Una compra no puede entrar en negativo ni un consumo en positivo. El ajuste admite los dos signos, porque puede sumar o restar.';

-- Down Migration

DROP TABLE movimientos_insumo;
