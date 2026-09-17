-- Up Migration

-- Lo que a Kokino le cuesta cada insumo. Con esto mas las recetas, el sistema
-- puede calcular cuanto cuesta producir un kilo de cada sabor, que es la
-- cuenta que hoy los duenos hacen a mano en la planilla de formulaciones.
--
-- Va en tabla propia y no junto a los costos de producto porque son cosas
-- distintas: un insumo se compra para transformarlo, un producto se compra
-- para revenderlo. Ademas sus unidades no se parecen, y una sola tabla
-- obligaria a mirar de que lado viene cada fila antes de poder sumarla.
CREATE TABLE costos_insumo (
  id_costo_insumo       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_insumo             INTEGER NOT NULL REFERENCES insumos (id_insumo) ON DELETE RESTRICT,
  costo                 NUMERIC(12,2) NOT NULL,
  fecha_vigencia_desde  DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vigencia_hasta  DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT costos_insumo_costo_check
    CHECK (costo >= 0),
  CONSTRAINT costos_insumo_vigencia_coherente_check
    CHECK (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= fecha_vigencia_desde)
);

CREATE UNIQUE INDEX costos_insumo_vigente_uidx
  ON costos_insumo (id_insumo)
  WHERE fecha_vigencia_hasta IS NULL;

CREATE TRIGGER trg_costos_insumo_set_updated_at
  BEFORE UPDATE ON costos_insumo
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE costos_insumo IS
  'Costo de compra de cada insumo, por unidad de compra. Un aumento del proveedor cierra el costo anterior y abre uno nuevo, asi se puede saber cuanto costaba producir un sabor en cualquier fecha pasada y no solo hoy.';
COMMENT ON COLUMN costos_insumo.costo IS
  'Costo por unidad de compra del insumo: si se compra por kilo, es el precio del kilo. Una receta que lo pida en gramos tiene que convertir con unidades_medida.factor_a_base antes de multiplicar.';

-- Down Migration

DROP TABLE costos_insumo;
