-- Up Migration

-- La venta mayorista se cierra por WhatsApp y la carga el dueño después, así que
-- no pertenece a ningún turno: obligarla a tener uno le sumaría al arqueo de ese
-- turno plata que nunca estuvo en el cajón.
ALTER TABLE ventas
  ALTER COLUMN id_caja DROP NOT NULL;

ALTER TABLE ventas
  ADD CONSTRAINT ventas_caja_segun_tipo_check
  CHECK (
    (tipo_venta = 'MINORISTA' AND id_caja IS NOT NULL)
    OR (tipo_venta = 'MAYORISTA' AND id_caja IS NULL)
  );

COMMENT ON COLUMN ventas.id_caja IS
  'Turno de caja al que pertenece la venta. Obligatorio en la minorista, que se cobra en el mostrador. Nulo en la mayorista, que no pasa por ninguna caja.';

COMMENT ON CONSTRAINT ventas_caja_segun_tipo_check ON ventas IS
  'La minorista exige caja y la mayorista la prohíbe. No alcanzaba con permitir nulos: sin esta regla una venta de mostrador podría quedar sin turno y el arqueo no cerraría sin que nadie se entere.';

-- Down Migration

ALTER TABLE ventas
  DROP CONSTRAINT ventas_caja_segun_tipo_check;

-- Falla a propósito si ya se cargaron ventas mayoristas, que por definición no
-- tienen caja: mejor un error claro que borrar esas filas en silencio.
ALTER TABLE ventas
  ALTER COLUMN id_caja SET NOT NULL;

COMMENT ON COLUMN ventas.id_caja IS NULL;
