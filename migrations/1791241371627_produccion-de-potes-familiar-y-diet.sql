-- Up Migration

-- Los potes Familiar y Diet (PRODUCIDO_DESDE_SABOR con stock propio) se
-- registran en Fabricacion como cualquier produccion, en potes, y suman a
-- su stock (decidido con la usuaria el 2026-10-05). Se hacen aparte: no
-- descuentan ningun tacho. No llevan receta (las recetas son solo de
-- PRODUCIDO_DIRECTO), asi que tampoco descuentan insumos.

CREATE OR REPLACE FUNCTION validar_produccion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_receta RECORD;
BEGIN
  IF NOT (SELECT tiene_fabrica FROM sucursales WHERE id_sucursal = NEW.id_sucursal) THEN
    RAISE EXCEPTION 'La sucursal % no tiene fabrica: la produccion se registra en la sucursal donde se fabrica', NEW.id_sucursal;
  END IF;

  IF NEW.id_producto IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM productos
        WHERE id_producto = NEW.id_producto
          AND tipo_origen IN ('PRODUCIDO_DIRECTO', 'PRODUCIDO_DESDE_SABOR') AND lleva_stock_propio) THEN
    RAISE EXCEPTION 'El producto % no se fabrica con stock propio (no es un producto propio que se guarda, como un impulsivo o un pote familiar), asi que no se registra como produccion', NEW.id_producto;
  END IF;

  IF NEW.id_receta IS NOT NULL THEN
    SELECT id_sabor_resultado, id_producto_resultado INTO v_receta
      FROM recetas WHERE id_receta = NEW.id_receta;
    IF v_receta.id_sabor_resultado IS DISTINCT FROM NEW.id_sabor
       OR v_receta.id_producto_resultado IS DISTINCT FROM NEW.id_producto THEN
      RAISE EXCEPTION 'La receta % no es la de lo que se produjo', NEW.id_receta;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION validar_produccion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_receta RECORD;
BEGIN
  IF NOT (SELECT tiene_fabrica FROM sucursales WHERE id_sucursal = NEW.id_sucursal) THEN
    RAISE EXCEPTION 'La sucursal % no tiene fabrica: la produccion se registra en la sucursal donde se fabrica', NEW.id_sucursal;
  END IF;

  IF NEW.id_producto IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM productos
        WHERE id_producto = NEW.id_producto
          AND tipo_origen = 'PRODUCIDO_DIRECTO' AND lleva_stock_propio) THEN
    RAISE EXCEPTION 'El producto % no se fabrica con stock propio (no es PRODUCIDO_DIRECTO con stock), asi que no se registra como produccion', NEW.id_producto;
  END IF;

  IF NEW.id_receta IS NOT NULL THEN
    SELECT id_sabor_resultado, id_producto_resultado INTO v_receta
      FROM recetas WHERE id_receta = NEW.id_receta;
    IF v_receta.id_sabor_resultado IS DISTINCT FROM NEW.id_sabor
       OR v_receta.id_producto_resultado IS DISTINCT FROM NEW.id_producto THEN
      RAISE EXCEPTION 'La receta % no es la de lo que se produjo', NEW.id_receta;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
