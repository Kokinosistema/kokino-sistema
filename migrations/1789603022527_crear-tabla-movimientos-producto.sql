-- Up Migration

CREATE TABLE movimientos_producto (
  id_movimiento_producto  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_producto             INTEGER NOT NULL REFERENCES productos (id_producto) ON DELETE RESTRICT,
  id_sucursal             INTEGER NOT NULL REFERENCES sucursales (id_sucursal) ON DELETE RESTRICT,
  tipo_movimiento         VARCHAR(30) NOT NULL,
  cantidad                NUMERIC(14,3) NOT NULL,
  id_produccion           INTEGER REFERENCES produccion (id_produccion) ON DELETE RESTRICT,
  id_traslado             INTEGER REFERENCES traslados (id_traslado) ON DELETE RESTRICT,
  id_usuario              INTEGER NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  fecha_hora              TIMESTAMPTZ NOT NULL DEFAULT now(),
  observaciones           TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT movimientos_producto_tipo_check
    CHECK (tipo_movimiento IN (
      'ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'SALIDA_VENTA',
      'ENTRADA_TRASLADO', 'SALIDA_TRASLADO', 'AJUSTE'
    )),
  CONSTRAINT movimientos_producto_cantidad_no_cero_check
    CHECK (cantidad <> 0),
  CONSTRAINT movimientos_producto_signo_check
    CHECK (
      (tipo_movimiento IN ('ENTRADA_COMPRA', 'ALTA_PRODUCCION', 'ENTRADA_TRASLADO') AND cantidad > 0)
      OR (tipo_movimiento IN ('SALIDA_VENTA', 'SALIDA_TRASLADO') AND cantidad < 0)
      OR tipo_movimiento = 'AJUSTE'
    ),
  CONSTRAINT movimientos_producto_produccion_coherente_check
    CHECK ((tipo_movimiento = 'ALTA_PRODUCCION') = (id_produccion IS NOT NULL)),
  CONSTRAINT movimientos_producto_traslado_coherente_check
    CHECK ((tipo_movimiento IN ('ENTRADA_TRASLADO', 'SALIDA_TRASLADO')) = (id_traslado IS NOT NULL))
);

CREATE INDEX movimientos_producto_stock_idx ON movimientos_producto (id_producto, id_sucursal);
CREATE INDEX movimientos_producto_fecha_idx ON movimientos_producto (fecha_hora);
CREATE INDEX movimientos_producto_id_produccion_idx ON movimientos_producto (id_produccion);
CREATE INDEX movimientos_producto_id_traslado_idx ON movimientos_producto (id_traslado);
CREATE INDEX movimientos_producto_id_usuario_idx ON movimientos_producto (id_usuario);

CREATE TRIGGER trg_movimientos_producto_set_updated_at
  BEFORE UPDATE ON movimientos_producto
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Un traslado siempre mueve la mercadería de un lado al otro, así que genera
-- dos movimientos que tienen que existir juntos. Crearlos acá evita que se
-- registre la salida y se olvide la entrada, lo que haría desaparecer stock.
CREATE FUNCTION registrar_movimientos_traslado_producto()
RETURNS TRIGGER AS $$
DECLARE
  v_origen   INTEGER;
  v_destino  INTEGER;
  v_usuario  INTEGER;
  v_fecha    TIMESTAMPTZ;
BEGIN
  SELECT id_sucursal_origen, id_sucursal_destino, id_usuario, fecha_envio
    INTO v_origen, v_destino, v_usuario, v_fecha
    FROM traslados WHERE id_traslado = NEW.id_traslado;

  INSERT INTO movimientos_producto
    (id_producto, id_sucursal, tipo_movimiento, cantidad, id_traslado, id_usuario, fecha_hora)
  VALUES
    (NEW.id_producto, v_origen,  'SALIDA_TRASLADO',  -NEW.cantidad, NEW.id_traslado, v_usuario, v_fecha),
    (NEW.id_producto, v_destino, 'ENTRADA_TRASLADO',  NEW.cantidad, NEW.id_traslado, v_usuario, v_fecha);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_traslado_productos_movimientos
  AFTER INSERT ON traslado_productos
  FOR EACH ROW
  EXECUTE FUNCTION registrar_movimientos_traslado_producto();

COMMENT ON TABLE movimientos_producto IS
  'Libro de entradas y salidas de productos terminados. El stock de un producto en una sucursal es la suma de sus movimientos. El helado a peso no está acá: se cuenta por tachos.';
COMMENT ON COLUMN movimientos_producto.tipo_movimiento IS
  'A diferencia de los insumos, los productos además se venden y viajan entre sucursales. SALIDA_VENTA todavía no tiene una FK a la venta porque el módulo de ventas aún no existe: se agrega cuando se cree.';
COMMENT ON FUNCTION registrar_movimientos_traslado_producto() IS
  'Genera la salida en la sucursal de origen y la entrada en la de destino cuando se suma un producto a un traslado.';

-- Down Migration

DROP TRIGGER trg_traslado_productos_movimientos ON traslado_productos;
DROP FUNCTION registrar_movimientos_traslado_producto();
DROP TABLE movimientos_producto;
