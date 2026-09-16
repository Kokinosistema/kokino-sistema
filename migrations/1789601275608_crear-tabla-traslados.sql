-- Up Migration

CREATE TABLE traslados (
  id_traslado         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_sucursal_origen  INTEGER NOT NULL REFERENCES sucursales (id_sucursal) ON DELETE RESTRICT,
  id_sucursal_destino INTEGER NOT NULL REFERENCES sucursales (id_sucursal) ON DELETE RESTRICT,
  id_usuario          INTEGER NOT NULL REFERENCES usuarios (id_usuario) ON DELETE RESTRICT,
  fecha_envio         TIMESTAMPTZ NOT NULL DEFAULT now(),
  observaciones       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT traslados_sucursales_distintas_check
    CHECK (id_sucursal_origen <> id_sucursal_destino)
);

CREATE INDEX traslados_id_sucursal_origen_idx ON traslados (id_sucursal_origen);
CREATE INDEX traslados_id_sucursal_destino_idx ON traslados (id_sucursal_destino);
CREATE INDEX traslados_id_usuario_idx ON traslados (id_usuario);
CREATE INDEX traslados_fecha_envio_idx ON traslados (fecha_envio);

CREATE TRIGGER trg_traslados_set_updated_at
  BEFORE UPDATE ON traslados
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE traslados IS
  'Envíos de mercadería entre sucursales. Solo viaja lo de producción propia: tachos de helado, bombones y repostería propia. Los insumos y la mercadería comprada no se trasladan, porque cada sucursal compra lo suyo.';
COMMENT ON COLUMN traslados.fecha_envio IS
  'Momento del envío. No hay fecha de recepción: el traslado es directo, el stock cambia de sucursal al registrarlo y no existe un estado en tránsito.';
COMMENT ON CONSTRAINT traslados_sucursales_distintas_check ON traslados IS
  'Una sucursal no puede trasladarse mercadería a sí misma.';

-- Down Migration

DROP TABLE traslados;
