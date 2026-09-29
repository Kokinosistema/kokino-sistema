-- Up Migration

-- Al cargar un insumo en un producto o en una receta, la unidad tiene que
-- poder convertirse a la unidad en que se compra el insumo. Hasta ahora eso
-- se descubria recien al usarla: un insumo que se compra en kilos cargado
-- "en unidades" se aceptaba sin aviso, y despues fallaba la venta del
-- producto en el mostrador, o la produccion en la fabrica. Con esto falla
-- al cargar, que es cuando quien carga puede corregirlo.
--
-- La regla es la misma que aplica convertir_a_unidad_de_compra al usar el
-- dato (misma magnitud, y en CONTEO la misma unidad), y se la llama a ella
-- para no escribirla dos veces ni que las dos versiones se separen con el
-- tiempo. El mensaje de error tambien sale de ahi.
CREATE FUNCTION validar_unidad_del_insumo()
RETURNS TRIGGER AS $$
DECLARE
  v_unidad_compra INTEGER;
  v_nombre        TEXT;
BEGIN
  SELECT id_unidad_medida, nombre INTO v_unidad_compra, v_nombre
    FROM insumos WHERE id_insumo = NEW.id_insumo;

  PERFORM convertir_a_unidad_de_compra(1, NEW.id_unidad_medida, v_unidad_compra, 'El insumo ' || v_nombre);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_producto_insumos_validar_unidad
  BEFORE INSERT OR UPDATE OF id_insumo, id_unidad_medida ON producto_insumos
  FOR EACH ROW
  EXECUTE FUNCTION validar_unidad_del_insumo();

CREATE TRIGGER trg_receta_detalle_validar_unidad
  BEFORE INSERT OR UPDATE OF id_insumo, id_unidad_medida ON receta_detalle
  FOR EACH ROW
  EXECUTE FUNCTION validar_unidad_del_insumo();

-- El mismo problema desde el otro lado: cambiarle la unidad de compra a un
-- insumo que ya esta en productos o recetas puede dejarlos incompatibles.
-- Se revisa cada uso con la unidad nueva, y el primero que no convierta
-- frena el cambio con su mensaje.
CREATE FUNCTION validar_cambio_de_unidad_de_insumo()
RETURNS TRIGGER AS $$
DECLARE
  v_uso RECORD;
BEGIN
  FOR v_uso IN
    SELECT pi.id_unidad_medida, 'el producto ' || p.nombre AS donde
      FROM producto_insumos pi
      JOIN productos p ON p.id_producto = pi.id_producto
     WHERE pi.id_insumo = NEW.id_insumo
    UNION ALL
    -- Una receta no tiene nombre propio: se la nombra por lo que produce.
    SELECT rd.id_unidad_medida,
           'la receta de ' || coalesce(s.nombre, pr.nombre) || ' (version ' || r.version || ')'
      FROM receta_detalle rd
      JOIN recetas r ON r.id_receta = rd.id_receta
      LEFT JOIN sabores s ON s.id_sabor = r.id_sabor_resultado
      LEFT JOIN productos pr ON pr.id_producto = r.id_producto_resultado
     WHERE rd.id_insumo = NEW.id_insumo
  LOOP
    PERFORM convertir_a_unidad_de_compra(1, v_uso.id_unidad_medida, NEW.id_unidad_medida,
      'El insumo ' || NEW.nombre || ' (usado en ' || v_uso.donde || ')');
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_insumos_validar_cambio_de_unidad
  BEFORE UPDATE OF id_unidad_medida ON insumos
  FOR EACH ROW
  WHEN (NEW.id_unidad_medida IS DISTINCT FROM OLD.id_unidad_medida)
  EXECUTE FUNCTION validar_cambio_de_unidad_de_insumo();

COMMENT ON FUNCTION validar_unidad_del_insumo() IS
  'Rechaza cargar un insumo en un producto o receta con una unidad que no convierte a la de compra.';
COMMENT ON FUNCTION validar_cambio_de_unidad_de_insumo() IS
  'Rechaza cambiar la unidad de compra de un insumo si deja incompatible algun producto o receta que lo usa.';

-- Down Migration

DROP TRIGGER trg_insumos_validar_cambio_de_unidad ON insumos;
DROP FUNCTION validar_cambio_de_unidad_de_insumo();

DROP TRIGGER trg_receta_detalle_validar_unidad ON receta_detalle;
DROP TRIGGER trg_producto_insumos_validar_unidad ON producto_insumos;
DROP FUNCTION validar_unidad_del_insumo();
