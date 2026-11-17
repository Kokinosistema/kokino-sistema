-- Up Migration

-- Hora argentina para toda la base (2026-11-03, al pasar a Vercel y
-- Supabase). Hasta ahora cada conexion la pedia al conectarse (src/db.js),
-- pero el pooler de Supabase no deja mandar esa opcion. Fijada en la base,
-- vale para todas las conexiones: las del sistema, las de los seeds y las de
-- quien se conecte a mano.
--
-- En Supabase, ALTER DATABASE lo tiene que correr el rol postgres (kokino_app
-- no es dueno de la base). Se aplico una vez a mano:
--   ALTER DATABASE postgres SET timezone = 'America/Argentina/Tucuman';
-- Esta migracion queda registrada para que el historial coincida.

SELECT 1;

-- Down Migration

SELECT 1;
