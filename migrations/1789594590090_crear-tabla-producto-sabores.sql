-- Up Migration

CREATE TABLE producto_sabores (
  id_producto_sabor  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_producto        INTEGER NOT NULL,
  tipo_origen        VARCHAR(30) NOT NULL DEFAULT 'PRODUCIDO_DESDE_SABOR',
  id_sabor           INTEGER NOT NULL REFERENCES sabores (id_sabor) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT producto_sabores_tipo_origen_check
    CHECK (tipo_origen = 'PRODUCIDO_DESDE_SABOR'),
  CONSTRAINT producto_sabores_id_producto_fkey
    FOREIGN KEY (id_producto, tipo_origen)
    REFERENCES productos (id_producto, tipo_origen)
    ON DELETE CASCADE,
  CONSTRAINT producto_sabores_producto_sabor_key
    UNIQUE (id_producto, id_sabor)
);

CREATE INDEX producto_sabores_id_sabor_idx ON producto_sabores (id_sabor);

CREATE TRIGGER trg_producto_sabores_set_updated_at
  BEFORE UPDATE ON producto_sabores
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE producto_sabores IS
  'Gustos fijos con los que viene armado un producto, como los envases familiares. Un producto sin filas acá no tiene gustos predefinidos: es el caso del térmico, donde el cliente elige en el mostrador y esos gustos no se registran en el sistema.';
COMMENT ON COLUMN producto_sabores.tipo_origen IS
  'Fija en PRODUCIDO_DESDE_SABOR por CHECK. Junto con id_producto forma la FK compuesta contra productos, que impide asignarle gustos de helado a una torta o a repostería comprada.';

-- Down Migration

DROP TABLE producto_sabores;
