-- Up Migration

-- Una venta guarda sus lineas en dos lugares segun lo que se vendio: los
-- productos van en venta_detalle y los tachos enteros del mayorista en
-- venta_tachos. Calcular cuanto valio una venta obliga entonces a sumar las
-- dos tablas, y cualquier consulta que se olvide de venta_tachos va a mostrar
-- las ventas mayoristas en cero sin avisar que falta algo.
--
-- La vista deja esa suma escrita una sola vez. No guarda datos ni ocupa
-- espacio: cada consulta la vuelve a calcular, asi que nunca queda vieja.
CREATE VIEW ventas_totales AS
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
COMMENT ON COLUMN ventas_totales.anulada IS
  'true si la venta fue anulada. Las anuladas siguen apareciendo en la vista porque hacen falta para auditar, asi que todo reporte de facturacion tiene que filtrarlas con NOT anulada.';
COMMENT ON COLUMN ventas_totales.canal_venta IS
  'Por donde entro la venta: mostrador, telefono o PedidosYa. Es independiente de tipo_venta, que dice a quien se le vendio: un mayorista puede comprar por mostrador.';

-- Down Migration

DROP VIEW ventas_totales;
