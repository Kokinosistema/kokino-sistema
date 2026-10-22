-- Up Migration

-- El envase comprado se cobra aparte del helado, como en el Sistema Rody
-- (definido con la usuaria el 2026-10-22): el tacho vale lo de la lista de
-- precios del sabor, y si el cliente se queda el envase se le suma su precio.
-- Se guarda en una columna propia y no sumado a precio_aplicado para que la
-- cotizacion y el remito muestren el envase en su renglon, y para que el
-- precio del helado se pueda comparar con la lista.
--
-- Las ventas anteriores quedan con el envase en 0: su precio_aplicado ya
-- traia el envase adentro, asi que su total no cambia.

ALTER TABLE venta_tachos
  ADD COLUMN precio_envase NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT venta_tachos_precio_envase_check CHECK (precio_envase >= 0),
  ADD CONSTRAINT venta_tachos_envase_prestado_gratis_check
    CHECK (envase = 'INCLUIDO' OR precio_envase = 0);

COMMENT ON COLUMN venta_tachos.precio_envase IS
  'Lo que se cobro por el envase, aparte del helado. Solo un envase INCLUIDO (el cliente se lo queda) se cobra; el RETORNABLE es prestado y vale 0. En las ventas anteriores al 2026-10-22 es 0 porque el envase venia dentro de precio_aplicado.';
COMMENT ON COLUMN venta_tachos.precio_aplicado IS
  'Lo que se cobro por el helado de este tacho, sin el envase (que va en precio_envase). Se guarda aca y no en venta_detalle porque el total de una venta mayorista sale de sus tachos. Puede no coincidir con la lista de precios: un acuerdo puntual con un mayorista es propio de esa venta.';

-- El total de la venta suma tambien los envases. CREATE OR REPLACE mantiene
-- las vistas que dependen de esta (alertas_cobros_de_mas), porque las
-- columnas no cambian.
CREATE OR REPLACE VIEW ventas_totales AS
SELECT v.id_venta,
       v.fecha_hora,
       v.canal_venta,
       v.tipo_venta,
       v.id_caja,
       v.id_cliente,
       v.id_usuario,
       v.fecha_anulacion IS NOT NULL AS anulada,
       coalesce((SELECT sum(vd.cantidad * vd.precio_unitario_aplicado)
                   FROM venta_detalle vd
                  WHERE vd.id_venta = v.id_venta), 0)
     + coalesce((SELECT sum(vt.precio_aplicado + vt.precio_envase)
                   FROM venta_tachos vt
                  WHERE vt.id_venta = v.id_venta), 0) AS total
  FROM ventas v;

COMMENT ON VIEW ventas_totales IS
  'Cada venta con su total ya calculado, sumando los productos de venta_detalle y los tachos enteros de venta_tachos (helado mas envase). Usarla en vez de sumar las tablas a mano: es la unica forma de que una venta mayorista no aparezca en cero por olvidarse una de las dos.';

-- Down Migration

-- Falla si alguna venta ya cobro un envase aparte: volver atras perderia esa
-- plata del total sin avisar.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM venta_tachos WHERE precio_envase > 0) THEN
    RAISE EXCEPTION 'Hay ventas con el envase cobrado aparte: no se puede volver atras sin cambiar su total';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW ventas_totales AS
SELECT v.id_venta,
       v.fecha_hora,
       v.canal_venta,
       v.tipo_venta,
       v.id_caja,
       v.id_cliente,
       v.id_usuario,
       v.fecha_anulacion IS NOT NULL AS anulada,
       coalesce((SELECT sum(vd.cantidad * vd.precio_unitario_aplicado)
                   FROM venta_detalle vd
                  WHERE vd.id_venta = v.id_venta), 0)
     + coalesce((SELECT sum(vt.precio_aplicado)
                   FROM venta_tachos vt
                  WHERE vt.id_venta = v.id_venta), 0) AS total
  FROM ventas v;

COMMENT ON VIEW ventas_totales IS
  'Cada venta con su total ya calculado, sumando los productos de venta_detalle y los tachos enteros de venta_tachos. Usarla en vez de sumar las tablas a mano: es la unica forma de que una venta mayorista no aparezca en cero por olvidarse una de las dos.';

COMMENT ON COLUMN venta_tachos.precio_aplicado IS
  'Lo que se cobró por este tacho. Se guarda acá y no en venta_detalle porque el total de una venta mayorista sale de sus tachos. Como en el detalle minorista, puede no coincidir con la lista de precios: un acuerdo puntual con un mayorista es propio de esa venta.';

ALTER TABLE venta_tachos
  DROP CONSTRAINT venta_tachos_envase_prestado_gratis_check,
  DROP CONSTRAINT venta_tachos_precio_envase_check,
  DROP COLUMN precio_envase;
