-- Up Migration

-- lotes dice que solo el helado lleva lote, pero nada lo impedia: como la
-- tabla apunta a produccion y no al sabor, se podia crear un lote a partir de
-- una produccion de tortas y despues fraccionarlo en tachos de helado.
--
-- No alcanza una FK compuesta como en otros casos, porque el dato que hay que
-- mirar no esta en produccion sino un salto mas alla, en la receta. Por eso va
-- como trigger.
CREATE FUNCTION validar_lote_de_helado()
RETURNS TRIGGER AS $$
DECLARE
  v_sabor INTEGER;
BEGIN
  SELECT r.id_sabor_resultado INTO v_sabor
    FROM produccion p
    JOIN recetas r ON r.id_receta = p.id_receta
   WHERE p.id_produccion = NEW.id_produccion;

  IF v_sabor IS NULL THEN
    RAISE EXCEPTION 'La produccion % no es de un sabor de helado, asi que no puede generar un lote: solo el helado se trazea por lote y se fracciona en tachos', NEW.id_produccion;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lotes_validar_helado
  BEFORE INSERT OR UPDATE OF id_produccion ON lotes
  FOR EACH ROW EXECUTE FUNCTION validar_lote_de_helado();

-- La densidad quedo opcional en sabores para poder cargar un sabor antes de
-- medirla, pero sin ella no se puede saber cuantos litros rinde un lote
-- medido en kilos. Se exige en el momento en que hace falta de verdad, que es
-- al fraccionar, en lugar de bloquear el alta del sabor.
CREATE FUNCTION validar_densidad_al_fraccionar()
RETURNS TRIGGER AS $$
DECLARE
  v_sabor    VARCHAR(100);
  v_densidad NUMERIC;
BEGIN
  -- Los tachos del arranque del sistema no tienen lote y quedan afuera: de
  -- esos no se sabe ni de que produccion vienen.
  IF NEW.id_lote IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.nombre, s.densidad_kg_por_litro INTO v_sabor, v_densidad
    FROM lotes l
    JOIN produccion p ON p.id_produccion = l.id_produccion
    JOIN recetas r    ON r.id_receta     = p.id_receta
    JOIN sabores s    ON s.id_sabor      = r.id_sabor_resultado
   WHERE l.id_lote = NEW.id_lote;

  IF v_densidad IS NULL THEN
    RAISE EXCEPTION 'El sabor % no tiene cargada la densidad, asi que no se sabe cuantos litros rinde el lote y no se lo puede fraccionar en tachos', v_sabor;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tachos_validar_densidad
  BEFORE INSERT ON tachos
  FOR EACH ROW EXECUTE FUNCTION validar_densidad_al_fraccionar();

COMMENT ON FUNCTION validar_lote_de_helado() IS
  'Impide crear un lote a partir de una produccion que no sea de un sabor de helado.';
COMMENT ON FUNCTION validar_densidad_al_fraccionar() IS
  'Exige que el sabor tenga densidad antes de fraccionar el lote en tachos, porque sin ella no se sabe cuantos litros rinde. No aplica a los tachos sin lote, que son los del arranque del sistema.';

-- Down Migration

DROP TRIGGER trg_tachos_validar_densidad ON tachos;
DROP FUNCTION validar_densidad_al_fraccionar();
DROP TRIGGER trg_lotes_validar_helado ON lotes;
DROP FUNCTION validar_lote_de_helado();
