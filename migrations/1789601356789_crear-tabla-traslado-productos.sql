-- Up Migration

CREATE TABLE traslado_productos (
  id_traslado_producto  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_traslado           INTEGER NOT NULL REFERENCES traslados (id_traslado) ON DELETE CASCADE,
  id_producto           INTEGER NOT NULL REFERENCES productos (id_producto) ON DELETE RESTRICT,
  cantidad              NUMERIC(12,3) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT traslado_productos_cantidad_check
    CHECK (cantidad > 0),
  CONSTRAINT traslado_productos_unico_key
    UNIQUE (id_traslado, id_producto)
);

CREATE INDEX traslado_productos_id_producto_idx ON traslado_productos (id_producto);

CREATE TRIGGER trg_traslado_productos_set_updated_at
  BEFORE UPDATE ON traslado_productos
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE traslado_productos IS
  'Productos enviados en un traslado, por cantidad. En la práctica viajan los de producción propia, como bombones y repostería, pero no se restringe por tipo de origen: que hoy no se manden cucuruchos comprados es una costumbre logística, no una regla, y el sistema no debería impedir registrar una excepción real.';

-- Down Migration

DROP TABLE traslado_productos;
