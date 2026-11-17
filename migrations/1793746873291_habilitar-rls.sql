-- Up Migration

-- El backend entra como kokino_app, dueno de estas tablas, y la sesion la
-- controla la aplicacion. La Data API de Supabase (la clave publicable) entra
-- como anon o authenticated: sin politicas, RLS les niega todas las filas.
-- No se fuerza RLS al dueno, porque eso dejaria al sistema sin poder leer lo
-- que el mismo acaba de guardar.

DO $$
DECLARE
  objeto record;
BEGIN
  FOR objeto IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', objeto.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', objeto.relname);
  END LOOP;

  FOR objeto IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'v'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', objeto.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', objeto.relname);
  END LOOP;
END $$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE kokino_app IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE kokino_app IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE kokino_app IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Down Migration

ALTER DEFAULT PRIVILEGES FOR ROLE kokino_app IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE kokino_app IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE kokino_app IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

DO $$
DECLARE
  objeto record;
BEGIN
  FOR objeto IN
    SELECT c.relname, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'v')
  LOOP
    IF objeto.relkind = 'r' THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', objeto.relname);
    ELSE
      EXECUTE format('ALTER VIEW public.%I RESET (security_invoker)', objeto.relname);
    END IF;
    EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated', objeto.relname);
  END LOOP;
END $$;
