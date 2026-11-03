-- Up Migration

-- Limite de intentos de login (ver src/intentos.js). Vivia en la memoria del
-- servidor, que alcanzaba con una sola PC. En Vercel hay varias copias del
-- sistema a la vez y cada una se apaga cuando no se usa: en memoria, cada
-- copia contaria por su lado y el limite dejaria de servir. En la base lo
-- comparten todas.

CREATE TABLE intentos_login (
  usuario TEXT PRIMARY KEY,
  veces   INTEGER NOT NULL CHECK (veces > 0),
  desde   TIMESTAMPTZ NOT NULL,
  hasta   TIMESTAMPTZ
);

COMMENT ON TABLE intentos_login IS
  'Contraseñas equivocadas por usuario (en minúsculas), para bloquearlo unos minutos. Se borra al entrar bien; lo vencido se limpia solo.';
COMMENT ON COLUMN intentos_login.desde IS 'Primer error de la ventana en la que se cuentan.';
COMMENT ON COLUMN intentos_login.hasta IS 'Hasta cuándo está bloqueado; null si todavía no llegó al límite.';

-- Down Migration

DROP TABLE intentos_login;
