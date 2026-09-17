-- Up Migration

-- Casi todos los insumos del helado se compran por kilo, pero las galletitas
-- vienen por paquete y los licores por botella. Se agregan como unidades de
-- CONTEO en vez de forzarlas a "unidad", para que el sistema hable como habla
-- quien compra: nadie pide medio paquete de galletitas.
--
-- El factor queda en 1 porque cada una es su propia base. Dentro de CONTEO no
-- tiene sentido convertir entre unidades distintas: un paquete no equivale a
-- una botella ni a una unidad, porque cuentan cosas que no se parecen.
INSERT INTO unidades_medida (nombre, abreviatura, magnitud, factor_a_base) VALUES
  ('Paquete', 'paq', 'CONTEO', 1),
  ('Botella', 'bot', 'CONTEO', 1);

-- Down Migration

DELETE FROM unidades_medida WHERE abreviatura IN ('paq', 'bot');
