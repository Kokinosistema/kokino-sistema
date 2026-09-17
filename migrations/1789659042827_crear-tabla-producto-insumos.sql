-- Up Migration

-- Hay insumos que no se gastan al fabricar sino al vender: el cono de un
-- cucurucho, el envase de un termico, la salsa que se sirve arriba. No entraban
-- en recetas, que describen una produccion, y por eso el stock de esos insumos
-- nunca bajaba: se compraban 500 conos, se vendian 300 cucuruchos y el sistema
-- seguia diciendo 500.
--
-- Que un insumo sea "de produccion" o "de venta" no se guarda como etiqueta del
-- insumo: se deduce de donde aparece. Si esta en receta_detalle es de
-- produccion, si esta aca es de venta, y si esta en las dos es las dos cosas.
-- Una etiqueta obligaria al dulce de leche a elegir un bando cuando es
-- ingrediente de una receta y tambien salsa de mostrador.
CREATE TABLE producto_insumos (
  id_producto_insumo  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_producto         INTEGER NOT NULL REFERENCES productos (id_producto) ON DELETE CASCADE,
  id_insumo           INTEGER NOT NULL REFERENCES insumos (id_insumo) ON DELETE RESTRICT,
  cantidad            NUMERIC(12,3) NOT NULL,
  id_unidad_medida    INTEGER NOT NULL REFERENCES unidades_medida (id_unidad) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT producto_insumos_cantidad_check
    CHECK (cantidad > 0),
  CONSTRAINT producto_insumos_unico_key
    UNIQUE (id_producto, id_insumo)
);

CREATE INDEX producto_insumos_id_producto_idx ON producto_insumos (id_producto);
CREATE INDEX producto_insumos_id_insumo_idx ON producto_insumos (id_insumo);

CREATE TRIGGER trg_producto_insumos_set_updated_at
  BEFORE UPDATE ON producto_insumos
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE producto_insumos IS
  'Insumos que gasta un producto cada vez que se vende, con su cantidad: un cucurucho gasta un cono, un térmico gasta un envase, una bolsa de cinco gasta cinco conos. Un producto sin filas acá no consume insumos al venderse.';
COMMENT ON COLUMN producto_insumos.id_unidad_medida IS
  'Unidad en la que se expresa la cantidad, que puede no ser la de compra del insumo: la salsa se compra por kilo y se sirve de a gramos. La conversión sale de unidades_medida.factor_a_base, dentro de la misma magnitud.';
COMMENT ON COLUMN producto_insumos.id_producto IS
  'ON DELETE CASCADE: si se borra el producto, la lista de lo que consumía deja de tener sentido. El insumo en cambio va con RESTRICT, porque borrarlo dejaría productos que dicen gastar algo que ya no existe.';
COMMENT ON CONSTRAINT producto_insumos_unico_key ON producto_insumos IS
  'Un insumo no puede figurar dos veces en el mismo producto: la cantidad total va en una sola fila.';

-- Down Migration

DROP TABLE producto_insumos;
