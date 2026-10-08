-- Up Migration

-- Sesiones guardadas en la base (2026-10-07). Hasta ahora vivian en la
-- memoria del servidor: cada reinicio (una actualizacion, un corte de luz)
-- deslogueaba a todos y perdia el pedido que se estaba armando en Vender,
-- que viaja en la sesion. Las usa connect-pg-simple (src/app.js), que borra
-- solas las vencidas.

CREATE TABLE sesiones (
  sid    VARCHAR     NOT NULL PRIMARY KEY,
  sess   JSON        NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE sesiones IS
  'Sesiones de quienes entraron al sistema (connect-pg-simple). Guarda quien es, la sucursal elegida y el pedido en curso de Vender. Se borran solas al vencer.';

CREATE INDEX sesiones_expire_idx ON sesiones (expire);

-- Down Migration

DROP TABLE sesiones;
