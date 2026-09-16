-- Up Migration

CREATE TABLE recetas (
  id_receta              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_sabor_resultado     INTEGER REFERENCES sabores (id_sabor) ON DELETE RESTRICT,
  id_producto_resultado  INTEGER REFERENCES productos (id_producto) ON DELETE RESTRICT,
  version                INTEGER NOT NULL DEFAULT 1,
  fecha_vigencia_desde   DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vigencia_hasta   DATE,
  cantidad_rendimiento   NUMERIC(10,3) NOT NULL,
  id_unidad_rendimiento  INTEGER NOT NULL REFERENCES unidades_medida (id_unidad) ON DELETE RESTRICT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recetas_resultado_excluyente_check
    CHECK (num_nonnulls(id_sabor_resultado, id_producto_resultado) = 1),
  CONSTRAINT recetas_version_check
    CHECK (version > 0),
  CONSTRAINT recetas_rendimiento_check
    CHECK (cantidad_rendimiento > 0),
  CONSTRAINT recetas_vigencia_coherente_check
    CHECK (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= fecha_vigencia_desde)
);

-- Una sola receta vigente por sabor y por producto en cada momento. Las
-- versiones cerradas (con fecha_vigencia_hasta cargada) quedan fuera del
-- índice, así el historial puede tener todas las que haga falta.
CREATE UNIQUE INDEX recetas_sabor_vigente_uidx
  ON recetas (id_sabor_resultado)
  WHERE fecha_vigencia_hasta IS NULL AND id_sabor_resultado IS NOT NULL;

CREATE UNIQUE INDEX recetas_producto_vigente_uidx
  ON recetas (id_producto_resultado)
  WHERE fecha_vigencia_hasta IS NULL AND id_producto_resultado IS NOT NULL;

CREATE INDEX recetas_id_unidad_rendimiento_idx ON recetas (id_unidad_rendimiento);

CREATE TRIGGER trg_recetas_set_updated_at
  BEFORE UPDATE ON recetas
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE recetas IS
  'Fórmulas de producción. Una receta produce un sabor de helado o un producto elaborado, nunca las dos cosas. Las fórmulas se versionan en vez de editarse encima: como produccion referencia la receta usada, pisar una fórmula haría mentir a las producciones ya registradas.';
COMMENT ON CONSTRAINT recetas_resultado_excluyente_check ON recetas IS
  'num_nonnulls cuenta cuántas de las columnas listadas no son nulas. Exigir que sea exactamente 1 obliga a completar el sabor o el producto, pero nunca ambos ni ninguno.';
COMMENT ON COLUMN recetas.fecha_vigencia_hasta IS
  'Nulo mientras la receta es la vigente. Al cargar una versión nueva se cierra la anterior con la fecha de corte. No hay columna activa: la vigencia se deriva de acá, para no tener el mismo dato en dos lugares que puedan contradecirse.';
COMMENT ON COLUMN recetas.cantidad_rendimiento IS
  'Cuánto produce la fórmula completa, expresado en id_unidad_rendimiento: kilos para un sabor, unidades para un producto elaborado como una torta.';

-- Down Migration

DROP TABLE recetas;
