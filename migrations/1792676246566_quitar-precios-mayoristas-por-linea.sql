-- Up Migration

-- Desde el 2026-10-22 se le vende a los mayoristas desde Cotizar, con las
-- listas de precios por sabor (precios_lista_mayorista). El precio unico por
-- linea y envase de la venta anterior ya no lo usa nada. Las ventas hechas
-- con el no pierden nada: cada tacho guardo lo que se cobro en
-- venta_tachos.precio_aplicado.

DROP TABLE precios_mayoristas;

-- Down Migration

-- Vuelve la tabla tal como la creo 1791212534948_ventas-mayoristas-precios-y-envases,
-- pero vacia: los precios que tenia no se recuperan.
CREATE TABLE precios_mayoristas (
  id_precio_mayorista  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  linea                VARCHAR(20)   NOT NULL,
  envase               VARCHAR(20)   NOT NULL,
  precio               NUMERIC(12,2) NOT NULL,
  fecha_vigencia_desde DATE          NOT NULL DEFAULT current_date,
  fecha_vigencia_hasta DATE,
  id_usuario           INTEGER       NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT precios_mayoristas_linea_check CHECK (linea IN ('ARTESANAL', 'FAMILIAR')),
  CONSTRAINT precios_mayoristas_envase_check CHECK (envase IN ('INCLUIDO', 'RETORNABLE')),
  CONSTRAINT precios_mayoristas_precio_check CHECK (precio >= 0),
  CONSTRAINT precios_mayoristas_vigencia_check
    CHECK (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= fecha_vigencia_desde)
);

COMMENT ON TABLE precios_mayoristas IS
  'Precio sugerido de un tacho para mayoristas, por linea y envase. Historico: el vigente es el que no tiene fecha_vigencia_hasta. En la venta se puede cambiar; lo cobrado queda en venta_tachos.precio_aplicado.';

CREATE UNIQUE INDEX precios_mayoristas_vigente_idx
  ON precios_mayoristas (linea, envase) WHERE fecha_vigencia_hasta IS NULL;
CREATE INDEX precios_mayoristas_id_usuario_idx ON precios_mayoristas (id_usuario);

CREATE TRIGGER trg_precios_mayoristas_set_updated_at
  BEFORE UPDATE ON precios_mayoristas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
