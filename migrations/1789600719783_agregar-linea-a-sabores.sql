-- Up Migration

-- Kokino produce dos líneas de helado en máquinas distintas: la familiar se
-- hace en una máquina que incorpora más aire, así que rinde más volumen, pesa
-- menos por litro y se vende a otro precio. Un mismo sabor puede existir en
-- las dos líneas con fórmula y densidad propias, aunque no todos lo hacen.
ALTER TABLE sabores
  ADD COLUMN linea VARCHAR(20) NOT NULL;

ALTER TABLE sabores
  ADD CONSTRAINT sabores_linea_check
  CHECK (linea IN ('ARTESANAL', 'FAMILIAR'));

-- El nombre deja de ser único por sí solo: pasa a serlo dentro de cada línea,
-- para que puedan convivir el dulce de leche artesanal y el familiar.
ALTER TABLE sabores
  DROP CONSTRAINT sabores_nombre_key;

ALTER TABLE sabores
  ADD CONSTRAINT sabores_nombre_linea_key UNIQUE (nombre, linea);

COMMENT ON COLUMN sabores.linea IS
  'Línea de producción del sabor. ARTESANAL y FAMILIAR se hacen en máquinas distintas, con recetas parecidas pero no iguales: la familiar gana volumen incorporando aire, de ahí su menor densidad y su precio diferente.';

-- Down Migration

ALTER TABLE sabores
  DROP CONSTRAINT sabores_nombre_linea_key;

ALTER TABLE sabores
  ADD CONSTRAINT sabores_nombre_key UNIQUE (nombre);

ALTER TABLE sabores
  DROP COLUMN linea;
