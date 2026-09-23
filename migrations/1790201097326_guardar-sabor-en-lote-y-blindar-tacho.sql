-- Up Migration

-- Saber de que sabor es un tacho costaba cuatro saltos: tacho, lote,
-- produccion, receta. Y es la consulta central del sistema, la que contesta
-- que gustos hay en cada sucursal.
--
-- El sabor pasa a guardarse en el lote. Parece redundante, pero el sabor de
-- una tanda es un hecho de esa tanda, no algo que haya que deducir de la
-- formula que se uso; es el mismo criterio con el que se guarda el precio
-- aplicado en la venta o el punto de venta en el comprobante. Lo completa un
-- trigger a partir de la produccion, asi nadie tiene que acordarse de cargarlo
-- y no puede terminar diciendo un sabor distinto al de su receta.
ALTER TABLE lotes ADD COLUMN id_sabor INTEGER REFERENCES sabores (id_sabor) ON DELETE RESTRICT;

UPDATE lotes l SET id_sabor = (
  SELECT r.id_sabor_resultado FROM produccion p JOIN recetas r ON r.id_receta = p.id_receta
   WHERE p.id_produccion = l.id_produccion
) WHERE l.id_sabor IS NULL;

CREATE FUNCTION completar_sabor_del_lote()
RETURNS TRIGGER AS $$
BEGIN
  SELECT r.id_sabor_resultado INTO NEW.id_sabor
    FROM produccion p JOIN recetas r ON r.id_receta = p.id_receta
   WHERE p.id_produccion = NEW.id_produccion;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Corre despues del que valida que la produccion sea de helado, por orden
-- alfabetico del nombre, asi que para cuando llega ya se sabe que hay sabor.
CREATE TRIGGER trg_lotes_completar_sabor
  BEFORE INSERT OR UPDATE OF id_produccion ON lotes
  FOR EACH ROW EXECUTE FUNCTION completar_sabor_del_lote();

ALTER TABLE lotes ALTER COLUMN id_sabor SET NOT NULL;
CREATE INDEX lotes_id_sabor_idx ON lotes (id_sabor);

COMMENT ON COLUMN lotes.id_sabor IS
  'Sabor de la tanda. Lo completa un trigger desde la produccion: no se carga a mano y no puede diferir de la receta. Se guarda en vez de deducirse porque preguntar que gustos hay en una sucursal es la consulta mas frecuente del sistema, y deducirlo obliga a recorrer produccion y receta en cada una.';

-- venta_detalle era la unica FK a ventas con ON DELETE CASCADE; las otras
-- cinco son RESTRICT, asi que ese CASCADE no se ejecutaba nunca: bastaba un
-- pago o un movimiento de stock para bloquear el borrado. La decision ya
-- estaba tomada en los hechos, una venta no se borra sino que se anula, asi
-- que el esquema la dice completa.
ALTER TABLE venta_detalle DROP CONSTRAINT venta_detalle_id_venta_fkey;
ALTER TABLE venta_detalle ADD CONSTRAINT venta_detalle_id_venta_fkey
  FOREIGN KEY (id_venta) REFERENCES ventas (id_venta) ON DELETE RESTRICT;

-- La ubicacion del tacho vive en su columna y tambien en el historial de
-- traslados. La copia es deliberada, porque reconstruir el recorrido en cada
-- consulta de stock saldria caro, pero nada impedia moverla por afuera con un
-- UPDATE suelto y dejar el historial mintiendo.
CREATE FUNCTION validar_movimiento_de_tacho()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id_sucursal = OLD.id_sucursal THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM traslado_tachos tt
      JOIN traslados t ON t.id_traslado = tt.id_traslado
     WHERE tt.id_tacho = NEW.id_tacho
       AND t.id_sucursal_origen  = OLD.id_sucursal
       AND t.id_sucursal_destino = NEW.id_sucursal
  ) THEN
    RAISE EXCEPTION 'Un tacho no se mueve cambiandole la sucursal: hay que registrar el traslado, que lo mueve y deja el historial. Falta el traslado del tacho % de la sucursal % a la %', NEW.id_tacho, OLD.id_sucursal, NEW.id_sucursal;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tachos_validar_movimiento
  BEFORE UPDATE OF id_sucursal ON tachos
  FOR EACH ROW EXECUTE FUNCTION validar_movimiento_de_tacho();

COMMENT ON FUNCTION validar_movimiento_de_tacho() IS
  'Impide cambiar la sucursal de un tacho sin el traslado que lo justifique. La columna es una copia deliberada del historial, para no reconstruir el recorrido en cada consulta de stock, y esto evita que las dos se contradigan.';

-- Down Migration

DROP TRIGGER trg_tachos_validar_movimiento ON tachos;
DROP FUNCTION validar_movimiento_de_tacho();

ALTER TABLE venta_detalle DROP CONSTRAINT venta_detalle_id_venta_fkey;
ALTER TABLE venta_detalle ADD CONSTRAINT venta_detalle_id_venta_fkey
  FOREIGN KEY (id_venta) REFERENCES ventas (id_venta) ON DELETE CASCADE;

DROP TRIGGER trg_lotes_completar_sabor ON lotes;
DROP FUNCTION completar_sabor_del_lote();
ALTER TABLE lotes DROP COLUMN id_sabor;
