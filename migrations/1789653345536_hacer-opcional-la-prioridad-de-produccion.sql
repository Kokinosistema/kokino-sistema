-- Up Migration

-- El dato sigue siendo util: ordena la produccion del dia para que un sabor
-- claro no salga manchado por los restos del anterior en la maquina. Lo que
-- cambia es que deja de ser un requisito para dar de alta un sabor, porque hoy
-- Kokino no lo tiene clasificado y exigirlo frenaba la carga de los 43 sabores.
-- Se deja opcional en vez de borrarse: eliminarlo no ahorraria el trabajo de
-- clasificarlos, solo lo postergaria perdiendo la estructura.
ALTER TABLE sabores
  ALTER COLUMN prioridad_produccion DROP NOT NULL;

COMMENT ON COLUMN sabores.prioridad_produccion IS
  'Orden de producción dentro de la jornada: primero los CLARO y después los OSCURO, para que un sabor claro no salga manchado por el anterior. Opcional: nulo significa sin clasificar todavía, no que dé lo mismo cuándo producirlo.';

-- Down Migration

-- Falla a proposito si hay sabores sin clasificar, que es justo lo que esta
-- migracion vino a permitir: habria que clasificarlos antes de volver a exigirlo.
ALTER TABLE sabores
  ALTER COLUMN prioridad_produccion SET NOT NULL;

COMMENT ON COLUMN sabores.prioridad_produccion IS
  'Orden de producción dentro de la jornada: primero los CLARO y después los OSCURO, para que un sabor claro no salga manchado por el anterior.';
