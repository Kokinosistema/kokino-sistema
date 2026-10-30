-- Up Migration

-- Tachos que llegaron sin estar en el ticket (definido con la usuaria el
-- 2026-10-30). Ejemplo: el ticket dice 2 de dulce de leche y en la camioneta
-- iban 1 de dulce de leche y 1 de chocolate. Al recibir, el destino informa
-- el sabor y la cantidad de lo que llego de mas, y el sistema suma al envio
-- los tachos llenos de ese sabor del origen que vencen primero (la misma
-- regla que al armarlo). Entran como recibidos, y al cerrar el envio pasan
-- al destino como cualquier otro.
--
-- La marca deja ver despues que estaba planeado y que se sumo en el destino,
-- para que los duenos revisen como se armo el envio.

ALTER TABLE traslado_tachos
  ADD COLUMN agregado_al_recibir BOOLEAN NOT NULL DEFAULT false;

-- Lo que se agrega al recibir es justamente lo que llego.
ALTER TABLE traslado_tachos
  ADD CONSTRAINT traslado_tachos_agregado_recibido_check
  CHECK (NOT agregado_al_recibir OR recibido IS TRUE);

COMMENT ON COLUMN traslado_tachos.agregado_al_recibir IS
  'true si el tacho no estaba en el ticket: lo sumó el destino al recibir, informando el sabor que llegó de más. Entra siempre como recibido.';

-- Igual que antes, mas que la marca de agregado tampoco se cambia despues.
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

-- Down Migration

-- Se pierde que tachos se agregaron al recibir: quedan como si hubieran
-- estado en el ticket. El stock no cambia.

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

ALTER TABLE traslado_tachos DROP COLUMN agregado_al_recibir;
