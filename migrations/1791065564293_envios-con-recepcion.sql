-- Up Migration

-- Envios con recepcion, definidos con la usuaria el 2026-10-03. Cambia la
-- decision original de "traslado directo, sin estado en transito ni
-- confirmacion":
--
--   1. Se arma el envio y queda EN_CAMINO. Sus tachos pasan a EN_CAMINO: ya
--      no son stock disponible en el origen (no se abren ni se reenvian),
--      pero todavia no suman en el destino.
--   2. En el destino se controla contra el ticket y se marca que llego. Al
--      recibirlo (RECIBIDO), lo que llego pasa al destino y lo que falta
--      queda como FALTANTE, con su motivo, para que lo revisen los duenos.
--   3. Mientras esta en camino, el origen lo puede cancelar: los tachos
--      vuelven a estar llenos y disponibles.
--
-- El stock se mueve al recibir, no al armar. Hasta ahora lo movian los
-- triggers al insertar cada renglon.

-- ------------------------------------------------------------------ traslados

ALTER TABLE traslados
  ADD COLUMN estado                 VARCHAR(20) NOT NULL DEFAULT 'EN_CAMINO',
  ADD COLUMN fecha_recepcion        TIMESTAMPTZ,
  ADD COLUMN id_usuario_recepcion   INTEGER REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  ADD COLUMN fecha_cancelacion      TIMESTAMPTZ,
  ADD COLUMN id_usuario_cancelacion INTEGER REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  ADD COLUMN motivo_cancelacion     TEXT;

CREATE INDEX traslados_estado_destino_idx ON traslados (id_sucursal_destino, estado);
CREATE INDEX traslados_id_usuario_recepcion_idx ON traslados (id_usuario_recepcion);
CREATE INDEX traslados_id_usuario_cancelacion_idx ON traslados (id_usuario_cancelacion);

ALTER TABLE traslados
  ADD CONSTRAINT traslados_estado_check
    CHECK (estado IN ('EN_CAMINO', 'RECIBIDO', 'CANCELADO')),
  ADD CONSTRAINT traslados_recepcion_completa_check
    CHECK ((estado = 'RECIBIDO') = (fecha_recepcion IS NOT NULL AND id_usuario_recepcion IS NOT NULL)),
  ADD CONSTRAINT traslados_cancelacion_completa_check
    CHECK ((estado = 'CANCELADO') = (fecha_cancelacion IS NOT NULL AND id_usuario_cancelacion IS NOT NULL
                                     AND btrim(coalesce(motivo_cancelacion, '')) <> ''));

-- ---------------------------------------------------------- renglones del envio

ALTER TABLE traslado_tachos
  ADD COLUMN recibido        BOOLEAN,
  ADD COLUMN motivo_faltante TEXT;

ALTER TABLE traslado_tachos
  ADD CONSTRAINT traslado_tachos_faltante_con_motivo_check
  CHECK (recibido IS DISTINCT FROM false OR btrim(coalesce(motivo_faltante, '')) <> '');

ALTER TABLE traslado_productos
  ADD COLUMN cantidad_recibida NUMERIC(12,3),
  ADD COLUMN motivo_faltante   TEXT;

ALTER TABLE traslado_productos
  ADD CONSTRAINT traslado_productos_recibida_check
    CHECK (cantidad_recibida IS NULL OR (cantidad_recibida >= 0 AND cantidad_recibida <= cantidad)),
  ADD CONSTRAINT traslado_productos_faltante_con_motivo_check
    CHECK (cantidad_recibida IS NULL OR cantidad_recibida = cantidad OR btrim(coalesce(motivo_faltante, '')) <> '');

-- --------------------------------------------------------------------- tachos

ALTER TABLE tachos DROP CONSTRAINT tachos_estado_check;
ALTER TABLE tachos ADD CONSTRAINT tachos_estado_check
  CHECK (estado IN ('LLENO', 'EN_POZO', 'VACIO', 'ENTREGADO_MAYORISTA', 'EN_CAMINO', 'FALTANTE'));

COMMENT ON COLUMN tachos.estado IS
  'LLENO recién fraccionado o guardado, EN_POZO abierto y vendiéndose por peso, VACIO consumido, ENTREGADO_MAYORISTA salió entero con un cliente mayorista, EN_CAMINO viajando en un envío todavía no recibido, FALTANTE salió en un envío y no llegó. Solo LLENO y EN_POZO cuentan como stock. El empleado no identifica el tacho: informa qué sabor se acabó y en qué sucursal, y el sistema toma el más viejo de esa sucursal.';

-- ------------------------------------------------------------------- triggers

-- Al cargar un tacho en un envio: tiene que estar lleno en el origen, y el
-- envio en camino. Queda EN_CAMINO en el origen: se mueve al recibir.
CREATE OR REPLACE FUNCTION mover_tacho_en_traslado()
RETURNS TRIGGER AS $$
DECLARE
  v_origen           INTEGER;
  v_estado_envio     VARCHAR(20);
  v_ubicacion_actual INTEGER;
  v_estado           VARCHAR(20);
BEGIN
  SELECT id_sucursal_origen, estado INTO v_origen, v_estado_envio
    FROM traslados WHERE id_traslado = NEW.id_traslado;
  IF v_estado_envio <> 'EN_CAMINO' THEN
    RAISE EXCEPTION 'El envío % ya está cerrado: no se le pueden agregar tachos', NEW.id_traslado;
  END IF;

  SELECT id_sucursal, estado INTO v_ubicacion_actual, v_estado
    FROM tachos WHERE id_tacho = NEW.id_tacho;
  IF v_ubicacion_actual <> v_origen THEN
    RAISE EXCEPTION 'El tacho % no está en la sucursal de origen del envío', NEW.id_tacho;
  END IF;
  -- Solo viajan tachos llenos: el del pozo esta abierto y se sigue vendiendo.
  IF v_estado <> 'LLENO' THEN
    RAISE EXCEPTION 'El tacho % no se puede enviar: está %, y solo viajan tachos llenos', NEW.id_tacho, lower(v_estado);
  END IF;

  UPDATE tachos SET estado = 'EN_CAMINO' WHERE id_tacho = NEW.id_tacho;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Al cargar un producto en un envio: solo se valida que el envio este en
-- camino. Los movimientos de stock se hacen al recibir.
CREATE OR REPLACE FUNCTION registrar_movimientos_traslado_producto()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT estado FROM traslados WHERE id_traslado = NEW.id_traslado) <> 'EN_CAMINO' THEN
    RAISE EXCEPTION 'El envío % ya está cerrado: no se le pueden agregar productos', NEW.id_traslado;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Un envio cerrado (recibido o cancelado) no cambia mas. Uno en camino solo
-- puede pasar a recibido o a cancelado, sin cambiar de donde a donde va; y
-- para recibirlo cada renglon tiene que tener anotado que llego.
CREATE FUNCTION validar_cambio_de_traslado()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado <> 'EN_CAMINO' THEN
    RAISE EXCEPTION 'El envío % ya está %: no admite cambios', OLD.id_traslado, lower(OLD.estado);
  END IF;
  IF NEW.id_sucursal_origen IS DISTINCT FROM OLD.id_sucursal_origen
     OR NEW.id_sucursal_destino IS DISTINCT FROM OLD.id_sucursal_destino
     OR NEW.id_usuario IS DISTINCT FROM OLD.id_usuario
     OR NEW.fecha_envio IS DISTINCT FROM OLD.fecha_envio THEN
    RAISE EXCEPTION 'No se cambia de dónde a dónde va un envío ni quién lo armó: si estaba mal, se cancela y se arma otro';
  END IF;
  IF NEW.estado = 'RECIBIDO' AND (
       EXISTS (SELECT 1 FROM traslado_tachos WHERE id_traslado = NEW.id_traslado AND recibido IS NULL)
       OR EXISTS (SELECT 1 FROM traslado_productos WHERE id_traslado = NEW.id_traslado AND cantidad_recibida IS NULL)) THEN
    RAISE EXCEPTION 'Para recibir el envío % hay que marcar qué llegó de cada renglón', NEW.id_traslado;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_traslados_validar_cambio
  BEFORE UPDATE ON traslados
  FOR EACH ROW
  EXECUTE FUNCTION validar_cambio_de_traslado();

-- Al cerrar un envio se mueve el stock. Recibido: lo que llego pasa al
-- destino, lleno; lo que no, queda FALTANTE en el origen. Los productos
-- salen del origen por lo enviado y entran al destino por lo recibido.
-- Cancelado: sus tachos vuelven a estar llenos en el origen.
CREATE FUNCTION cerrar_traslado()
RETURNS TRIGGER AS $$
DECLARE
  v_fila RECORD;
BEGIN
  IF NEW.estado = 'RECIBIDO' THEN
    UPDATE tachos t SET id_sucursal = NEW.id_sucursal_destino, estado = 'LLENO'
      FROM traslado_tachos tt
     WHERE tt.id_traslado = NEW.id_traslado AND tt.id_tacho = t.id_tacho AND tt.recibido;
    UPDATE tachos t SET estado = 'FALTANTE'
      FROM traslado_tachos tt
     WHERE tt.id_traslado = NEW.id_traslado AND tt.id_tacho = t.id_tacho AND NOT tt.recibido;

    FOR v_fila IN SELECT id_producto, cantidad, cantidad_recibida FROM traslado_productos WHERE id_traslado = NEW.id_traslado LOOP
      INSERT INTO movimientos_producto
        (id_producto, id_sucursal, tipo_movimiento, cantidad, id_traslado, id_usuario, fecha_hora)
      VALUES (v_fila.id_producto, NEW.id_sucursal_origen, 'SALIDA_TRASLADO', -v_fila.cantidad,
              NEW.id_traslado, NEW.id_usuario_recepcion, NEW.fecha_recepcion);
      IF v_fila.cantidad_recibida > 0 THEN
        INSERT INTO movimientos_producto
          (id_producto, id_sucursal, tipo_movimiento, cantidad, id_traslado, id_usuario, fecha_hora)
        VALUES (v_fila.id_producto, NEW.id_sucursal_destino, 'ENTRADA_TRASLADO', v_fila.cantidad_recibida,
                NEW.id_traslado, NEW.id_usuario_recepcion, NEW.fecha_recepcion);
      END IF;
    END LOOP;
  ELSIF NEW.estado = 'CANCELADO' THEN
    UPDATE tachos t SET estado = 'LLENO'
      FROM traslado_tachos tt
     WHERE tt.id_traslado = NEW.id_traslado AND tt.id_tacho = t.id_tacho AND t.estado = 'EN_CAMINO';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_traslados_cerrar
  AFTER UPDATE OF estado ON traslados
  FOR EACH ROW
  WHEN (OLD.estado = 'EN_CAMINO' AND NEW.estado <> 'EN_CAMINO')
  EXECUTE FUNCTION cerrar_traslado();

-- Los renglones no se borran ni se cambian, salvo anotar que llego mientras
-- el envio esta en camino.
CREATE FUNCTION congelar_renglon_de_traslado()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un renglón de un envío no se borra: si el envío estaba mal, se cancela y se arma otro';
  END IF;
  IF (SELECT estado FROM traslados WHERE id_traslado = OLD.id_traslado) <> 'EN_CAMINO' THEN
    RAISE EXCEPTION 'El envío % ya está cerrado: sus renglones no cambian', OLD.id_traslado;
  END IF;
  IF TG_TABLE_NAME = 'traslado_tachos' THEN
    IF NEW.id_traslado IS DISTINCT FROM OLD.id_traslado OR NEW.id_tacho IS DISTINCT FROM OLD.id_tacho THEN
      RAISE EXCEPTION 'De un renglón de envío solo se anota si llegó';
    END IF;
  ELSIF NEW.id_traslado IS DISTINCT FROM OLD.id_traslado OR NEW.id_producto IS DISTINCT FROM OLD.id_producto
        OR NEW.cantidad IS DISTINCT FROM OLD.cantidad THEN
    RAISE EXCEPTION 'De un renglón de envío solo se anota cuánto llegó';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_traslado_tachos_congelar
  BEFORE UPDATE OR DELETE ON traslado_tachos
  FOR EACH ROW
  EXECUTE FUNCTION congelar_renglon_de_traslado();

CREATE TRIGGER trg_traslado_productos_congelar
  BEFORE UPDATE OR DELETE ON traslado_productos
  FOR EACH ROW
  EXECUTE FUNCTION congelar_renglon_de_traslado();

COMMENT ON COLUMN traslados.estado IS
  'EN_CAMINO mientras viaja; RECIBIDO cuando el destino controló y marcó qué llegó (ahí se mueve el stock); CANCELADO si el origen lo anuló antes de recibirlo (sus tachos vuelven a estar llenos).';
COMMENT ON COLUMN traslado_tachos.recibido IS
  'Si el tacho llegó: vacío mientras el envío está en camino, true o false al recibirlo. Un tacho que no llegó lleva motivo y queda FALTANTE.';
COMMENT ON COLUMN traslado_productos.cantidad_recibida IS
  'Cuánto llegó del producto, anotado al recibir. Lo que falta contra cantidad lleva motivo: sale del origen igual, porque se envió.';

-- Down Migration

-- Falla si ya hay envios en camino o tachos EN_CAMINO o FALTANTE, que la
-- version anterior no admite: en ese caso no hay que revertir, sino
-- corregir hacia adelante.

DROP TRIGGER trg_traslado_productos_congelar ON traslado_productos;
DROP TRIGGER trg_traslado_tachos_congelar ON traslado_tachos;
DROP FUNCTION congelar_renglon_de_traslado();
DROP TRIGGER trg_traslados_cerrar ON traslados;
DROP FUNCTION cerrar_traslado();
DROP TRIGGER trg_traslados_validar_cambio ON traslados;
DROP FUNCTION validar_cambio_de_traslado();

CREATE OR REPLACE FUNCTION registrar_movimientos_traslado_producto()
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

CREATE OR REPLACE FUNCTION mover_tacho_en_traslado()
RETURNS TRIGGER AS $$
DECLARE
  v_origen           INTEGER;
  v_destino          INTEGER;
  v_ubicacion_actual INTEGER;
  v_estado           VARCHAR(20);
BEGIN
  SELECT id_sucursal_origen, id_sucursal_destino
    INTO v_origen, v_destino
    FROM traslados WHERE id_traslado = NEW.id_traslado;

  SELECT id_sucursal, estado
    INTO v_ubicacion_actual, v_estado
    FROM tachos WHERE id_tacho = NEW.id_tacho;

  IF v_ubicacion_actual <> v_origen THEN
    RAISE EXCEPTION 'El tacho % no está en la sucursal de origen del traslado', NEW.id_tacho;
  END IF;

  IF v_estado = 'VACIO' THEN
    RAISE EXCEPTION 'No se puede trasladar el tacho %: ya está vacío', NEW.id_tacho;
  END IF;

  UPDATE tachos SET id_sucursal = v_destino WHERE id_tacho = NEW.id_tacho;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN tachos.estado IS
  'LLENO recién fraccionado o guardado, EN_POZO abierto y vendiéndose por peso, VACIO consumido, ENTREGADO_MAYORISTA salió entero con un cliente mayorista. Solo LLENO y EN_POZO cuentan como stock. El empleado no identifica el tacho: informa qué sabor se acabó y en qué sucursal, y el sistema toma el más viejo de esa sucursal.';
ALTER TABLE tachos DROP CONSTRAINT tachos_estado_check;
ALTER TABLE tachos ADD CONSTRAINT tachos_estado_check
  CHECK (estado IN ('LLENO', 'EN_POZO', 'VACIO', 'ENTREGADO_MAYORISTA'));

ALTER TABLE traslado_productos
  DROP CONSTRAINT traslado_productos_faltante_con_motivo_check,
  DROP CONSTRAINT traslado_productos_recibida_check,
  DROP COLUMN motivo_faltante,
  DROP COLUMN cantidad_recibida;

ALTER TABLE traslado_tachos
  DROP CONSTRAINT traslado_tachos_faltante_con_motivo_check,
  DROP COLUMN motivo_faltante,
  DROP COLUMN recibido;

ALTER TABLE traslados
  DROP CONSTRAINT traslados_cancelacion_completa_check,
  DROP CONSTRAINT traslados_recepcion_completa_check,
  DROP CONSTRAINT traslados_estado_check;
DROP INDEX traslados_id_usuario_cancelacion_idx;
DROP INDEX traslados_id_usuario_recepcion_idx;
DROP INDEX traslados_estado_destino_idx;
ALTER TABLE traslados
  DROP COLUMN motivo_cancelacion,
  DROP COLUMN id_usuario_cancelacion,
  DROP COLUMN fecha_cancelacion,
  DROP COLUMN id_usuario_recepcion,
  DROP COLUMN fecha_recepcion,
  DROP COLUMN estado;
