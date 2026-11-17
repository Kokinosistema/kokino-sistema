-- Up Migration

-- Supabase marca las funciones sin search_path fijo. Estas son triggers del
-- sistema y nombran las tablas sin esquema, asi que el camino queda en public.

DO $$
DECLARE
  funcion record;
BEGIN
  FOR funcion IN
    SELECT n.nspname AS esquema,
           p.proname AS nombre,
           pg_get_function_identity_arguments(p.oid) AS argumentos
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public',
      funcion.esquema, funcion.nombre, funcion.argumentos
    );
  END LOOP;
END $$;

-- Down Migration

DO $$
DECLARE
  funcion record;
BEGIN
  FOR funcion IN
    SELECT n.nspname AS esquema,
           p.proname AS nombre,
           pg_get_function_identity_arguments(p.oid) AS argumentos
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) RESET search_path',
      funcion.esquema, funcion.nombre, funcion.argumentos
    );
  END LOOP;
END $$;
