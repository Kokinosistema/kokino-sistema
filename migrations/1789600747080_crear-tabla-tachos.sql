-- Up Migration

CREATE TABLE tachos (
  id_tacho          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_lote           INTEGER NOT NULL REFERENCES lotes (id_lote) ON DELETE RESTRICT,
  id_sucursal       INTEGER NOT NULL REFERENCES sucursales (id_sucursal) ON DELETE RESTRICT,
  codigo_barras     VARCHAR(50) NOT NULL UNIQUE,
  capacidad_litros  NUMERIC(5,2) NOT NULL,
  estado            VARCHAR(20) NOT NULL DEFAULT 'LLENO',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tachos_estado_check
    CHECK (estado IN ('LLENO', 'EN_POZO', 'VACIO')),
  CONSTRAINT tachos_capacidad_check
    CHECK (capacidad_litros > 0)
);

CREATE INDEX tachos_id_lote_idx ON tachos (id_lote);

-- Índice pensado para la consulta central del sistema: qué tachos sin vaciar
-- hay de cada sabor en cada sucursal. Sirve tanto para el stock como para
-- elegir el tacho más viejo al registrar que un sabor se acabó.
CREATE INDEX tachos_stock_idx
  ON tachos (id_sucursal, estado, id_lote)
  WHERE estado <> 'VACIO';

CREATE TRIGGER trg_tachos_set_updated_at
  BEFORE UPDATE ON tachos
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE tachos IS
  'Envases individuales en que se fracciona un lote de helado. Son la unidad real de stock: el helado a peso no descuenta en cada venta, sino cuando un tacho se termina.';
COMMENT ON COLUMN tachos.id_sucursal IS
  'Dónde está el tacho ahora. Nace en la sucursal que produjo y cambia cuando se lo manda a la otra. Contar los tachos sin vaciar por sabor y sucursal es lo que da el stock de helado.';
COMMENT ON COLUMN tachos.estado IS
  'LLENO recién fraccionado o guardado, EN_POZO abierto y vendiéndose por peso, VACIO consumido. Al marcarlo vacío sale del stock. El empleado no identifica el tacho: informa qué sabor se acabó y en qué sucursal, y el sistema toma el más viejo de esa sucursal.';
COMMENT ON COLUMN tachos.capacidad_litros IS
  'Litros del envase, habitualmente 10, 5 o 3. El de 10 es el que compran los mayoristas. No se guarda el vencimiento: es el del lote, y está impreso en el código de barras.';

-- Down Migration

DROP TABLE tachos;
