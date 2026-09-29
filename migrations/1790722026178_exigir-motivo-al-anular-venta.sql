-- Up Migration

-- Los duenos decidieron que toda anulacion lleve su motivo: quien y cuando ya
-- quedaban registrados, pero sin el por que, cada anulacion obliga a
-- preguntarle a quien la hizo. La pantalla lo pide, y la base lo exige por si
-- alguna vez se anula por otro camino.
--
-- Un motivo de puros espacios cuenta como vacio: si no, se esquiva la regla
-- apretando la barra espaciadora.
ALTER TABLE ventas
  ADD CONSTRAINT ventas_anulacion_con_motivo_check
  CHECK (fecha_anulacion IS NULL OR btrim(coalesce(motivo_anulacion, '')) <> '');

COMMENT ON COLUMN ventas.motivo_anulacion IS
  'Por que se anulo la venta. Obligatorio cuando la venta esta anulada (ventas_anulacion_con_motivo_check).';

-- Down Migration

COMMENT ON COLUMN ventas.motivo_anulacion IS NULL;

ALTER TABLE ventas DROP CONSTRAINT ventas_anulacion_con_motivo_check;
