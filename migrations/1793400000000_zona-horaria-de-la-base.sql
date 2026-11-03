-- Up Migration

-- Hora argentina para toda la base (2026-11-03, al pasar a Vercel y
-- Supabase). Hasta ahora cada conexion la pedia al conectarse (src/db.js),
-- pero el pooler de Supabase no deja mandar esa opcion. Fijada en la base,
-- vale para todas las conexiones: las del sistema, las de los seeds y las de
-- quien se conecte a mano.
--
-- Se aplica a las conexiones que se abren despues de esta migracion.

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'America/Argentina/Tucuman');
END
$$;

-- Down Migration

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I RESET timezone', current_database());
END
$$;
