-- Up Migration

-- Productos que llegaron sin estar en el ticket (definido con la usuaria el
-- 2026-10-30), como 1793364195917_tachos-agregados-al-recibir hizo con los
-- tachos. Al recibir, el destino informa el producto y la cantidad de lo que
-- llego de mas, y se suma al envio un renglon ya recibido.
--
-- Tambien cubre que llegue mas de lo enviado: el ticket dice 10 palitos y
-- llegan 12. El renglon del ticket queda con 10 recibidos y se agrega otro de
-- 2. Por eso un producto puede tener dos renglones en el envio: el del ticket
-- y el agregado. cerrar_traslado ya recorre renglon por renglon, asi que
-- descuenta y suma los dos sin cambios.

ALTER TABLE traslado_productos
  ADD COLUMN agregado_al_recibir BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE traslado_productos
  DROP CONSTRAINT traslado_productos_unico_key,
  ADD CONSTRAINT traslado_productos_unico_key
    UNIQUE (id_traslado, id_producto, agregado_al_recibir),
  -- Lo que se agrega al recibir es justamente lo que llego.
  ADD CONSTRAINT traslado_productos_agregado_recibido_check
    CHECK (NOT agregado_al_recibir OR cantidad_recibida = cantidad);

COMMENT ON COLUMN traslado_productos.agregado_al_recibir IS
  'true si el renglón no estaba en el ticket: lo sumó el destino al recibir, informando el producto y cuánto llegó de más. Entra siempre recibido completo. Un producto puede tener un renglón del ticket y uno agregado.';

-- Igual que antes, mas que la marca de agregado de los productos tampoco se
-- cambia despues.
CREATE OR REPLACE FUNCTION congelar_renglon_de_traslado()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un renglón de un envío no se borra: si el envío estaba mal, se cancela y se arma otro';
  END IF;
  IF (SELECT estado FROM traslados WHERE id_traslado = OLD.id_traslado) <> 'EN_CAMINO' THEN
    RAISE EXCEPTION 'El envío % ya está cerrado: sus renglones no cambian', OLD.id_traslado;
  END IF;
  IF TG_TABLE_NAME = 'traslado_tachos' THEN
    IF NEW.id_traslado IS DISTINCT FROM OLD.id_traslado OR NEW.id_tacho IS DISTINCT FROM OLD.id_tacho
       OR NEW.agregado_al_recibir IS DISTINCT FROM OLD.agregado_al_recibir THEN
      RAISE EXCEPTION 'De un renglón de envío solo se anota si llegó';
    END IF;
  ELSIF NEW.id_traslado IS DISTINCT FROM OLD.id_traslado OR NEW.id_producto IS DISTINCT FROM OLD.id_producto
        OR NEW.cantidad IS DISTINCT FROM OLD.cantidad OR NEW.agregado_al_recibir IS DISTINCT FROM OLD.agregado_al_recibir THEN
    RAISE EXCEPTION 'De un renglón de envío solo se anota cuánto llegó';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration

-- Se pierde que renglones se agregaron al recibir. Falla si algun envio ya
-- tiene un producto en dos renglones (el del ticket y el agregado), que la
-- version anterior no admite: en ese caso no hay que revertir, sino
-- corregir hacia adelante.

CREATE OR REPLACE FUNCTION congelar_renglon_de_traslado()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un renglón de un envío no se borra: si el envío estaba mal, se cancela y se arma otro';
  END IF;
  IF (SELECT estado FROM traslados WHERE id_traslado = OLD.id_traslado) <> 'EN_CAMINO' THEN
    RAISE EXCEPTION 'El envío % ya está cerrado: sus renglones no cambian', OLD.id_traslado;
  END IF;
  IF TG_TABLE_NAME = 'traslado_tachos' THEN
    IF NEW.id_traslado IS DISTINCT FROM OLD.id_traslado OR NEW.id_tacho IS DISTINCT FROM OLD.id_tacho
       OR NEW.agregado_al_recibir IS DISTINCT FROM OLD.agregado_al_recibir THEN
      RAISE EXCEPTION 'De un renglón de envío solo se anota si llegó';
    END IF;
  ELSIF NEW.id_traslado IS DISTINCT FROM OLD.id_traslado OR NEW.id_producto IS DISTINCT FROM OLD.id_producto
        OR NEW.cantidad IS DISTINCT FROM OLD.cantidad THEN
    RAISE EXCEPTION 'De un renglón de envío solo se anota cuánto llegó';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Al borrar la columna se van con ella la unica de tres columnas y su check.
ALTER TABLE traslado_productos DROP COLUMN agregado_al_recibir;
ALTER TABLE traslado_productos
  ADD CONSTRAINT traslado_productos_unico_key UNIQUE (id_traslado, id_producto);
