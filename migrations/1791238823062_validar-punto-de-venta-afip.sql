-- Up Migration

-- El punto de venta de AFIP lo cargan los duenos desde la pantalla de
-- Sucursales (2026-10-05). AFIP numera los puntos de venta de 1 a 99999.
-- Que dos sucursales no tengan el mismo ya lo exige el indice
-- sucursales_punto_venta_afip_uidx.

ALTER TABLE sucursales
  ADD CONSTRAINT sucursales_punto_venta_afip_check
    CHECK (punto_venta_afip BETWEEN 1 AND 99999);

COMMENT ON COLUMN sucursales.punto_venta_afip IS
  'Número de punto de venta fiscal asignado por AFIP para esta sucursal (1 a 99999, uno distinto por sucursal). Lo cargan los dueños desde la pantalla de Sucursales; nulo hasta que lo tengan.';

-- Down Migration

ALTER TABLE sucursales DROP CONSTRAINT sucursales_punto_venta_afip_check;

COMMENT ON COLUMN sucursales.punto_venta_afip IS
  'Número de punto de venta fiscal asignado por AFIP para esta sucursal. Nulo en las dos: todavía no se pidieron, se cargan al integrar la facturación electrónica.';
