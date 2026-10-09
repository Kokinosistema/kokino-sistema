'use strict';

const { consultar } = require('./db');

// Metricas del Inicio de los duenos (pedidas por la usuaria el 2026-10-03).
// Todo es de la sucursal de trabajo (la elegida arriba), salvo la
// comparacion entre sucursales. Las ventas anuladas no cuentan en ningun
// numero de ventas: aparecen aparte, en el control de caja. Son las ventas
// de mostrador: las mayoristas (tachos enteros) tienen sus propias
// estadisticas en la solapa de mayoristas.
//
// El total de una venta es la suma de sus renglones (cantidad por precio
// cobrado). No hay ganancia ni margen: casi ningun producto tiene costo
// cargado y el numero saldria mal.
//
// Las fechas son las de la base, que esta en hora argentina.

// Ventas validas con su total, desde un momento (una expresion SQL fija de
// este archivo, nunca algo que venga del usuario). $1 = sucursal, o null
// para todas.
const ventas = (desde) => `
  SELECT v.id_venta, v.id_sucursal, v.fecha_hora, v.canal_venta,
         (SELECT sum(d.cantidad * d.precio_unitario_aplicado) FROM venta_detalle d WHERE d.id_venta = v.id_venta) AS total
    FROM ventas v
   WHERE v.fecha_anulacion IS NULL
     AND v.tipo_venta = 'MINORISTA'
     AND ($1::int IS NULL OR v.id_sucursal = $1)
     AND v.fecha_hora >= ${desde}`;

// Hoy, la semana (de lunes a hoy) y el mes, cada uno contra el periodo
// anterior equivalente y hasta la misma hora: a las 15 de un martes, hoy se
// compara con el martes pasado hasta las 15, no con el dia entero.
const PERIODOS = [
  { clave: 'hoy', nombre: 'Hoy', contra: 'contra el mismo día de la semana pasada, a esta hora',
    desde: "date_trunc('day', now())", antes: "date_trunc('day', now()) - interval '7 days'", hastaAntes: "now() - interval '7 days'" },
  { clave: 'semana', nombre: 'Esta semana', contra: 'de lunes a hoy, contra los mismos días de la semana pasada',
    desde: "date_trunc('week', now())", antes: "date_trunc('week', now()) - interval '7 days'", hastaAntes: "now() - interval '7 days'" },
  { clave: 'mes', nombre: 'Este mes', contra: 'contra el mes pasado hasta el mismo día',
    desde: "date_trunc('month', now())", antes: "date_trunc('month', now()) - interval '1 month'", hastaAntes: "now() - interval '1 month'" },
];

function variacion(actual, anterior) {
  if (anterior === 0) return actual > 0 ? { texto: 'el período anterior no tuvo ventas', clase: 'neutra' } : { texto: 'sin ventas en los dos períodos', clase: 'neutra' };
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  if (pct === 0) return { texto: 'igual que el período anterior', clase: 'neutra' };
  return { texto: (pct > 0 ? '+' : '') + pct + ' %', clase: pct > 0 ? 'sube' : 'baja' };
}

async function periodos(idSucursal) {
  const columnas = PERIODOS.map((p) => `
    coalesce(sum(total) FILTER (WHERE fecha_hora >= ${p.desde}), 0) AS ${p.clave}_total,
    count(*) FILTER (WHERE fecha_hora >= ${p.desde})::int AS ${p.clave}_ventas,
    coalesce(sum(total) FILTER (WHERE fecha_hora >= ${p.antes} AND fecha_hora < ${p.hastaAntes}), 0) AS ${p.clave}_total_antes,
    count(*) FILTER (WHERE fecha_hora >= ${p.antes} AND fecha_hora < ${p.hastaAntes})::int AS ${p.clave}_ventas_antes`).join(',');
  // Lo mas viejo que se mira es el principio del mes pasado o de la semana
  // pasada, lo que caiga antes.
  const desde = "least(date_trunc('month', now()) - interval '1 month', date_trunc('week', now()) - interval '7 days')";
  const { rows: [f] } = await consultar(`WITH v AS (${ventas(desde)}) SELECT ${columnas} FROM v`, [idSucursal]);
  return PERIODOS.map((p) => {
    const total = Number(f[p.clave + '_total']);
    const ventas = f[p.clave + '_ventas'];
    const totalAntes = Number(f[p.clave + '_total_antes']);
    const ventasAntes = f[p.clave + '_ventas_antes'];
    const ticket = ventas > 0 ? total / ventas : 0;
    const ticketAntes = ventasAntes > 0 ? totalAntes / ventasAntes : 0;
    return {
      nombre: p.nombre, contra: p.contra, total, ventas, ticket,
      varTotal: variacion(total, totalAntes),
      varVentas: variacion(ventas, ventasAntes),
      varTicket: variacion(ticket, ticketAntes),
    };
  });
}

// Ventas de cada dia de los ultimos 14, con los dias sin ventas en cero.
async function ultimosDias(idSucursal) {
  const { rows } = await consultar(
    `WITH v AS (${ventas('current_date - 13')})
     SELECT d::date AS dia, coalesce(sum(v.total), 0) AS total, count(v.id_venta)::int AS ventas,
            d::date = current_date AS es_hoy
       FROM generate_series(current_date - 13, current_date, interval '1 day') d
       LEFT JOIN v ON v.fecha_hora::date = d::date
      GROUP BY d
      ORDER BY d`,
    [idSucursal]
  );
  return rows.map((r) => ({ dia: r.dia, total: Number(r.total), ventas: r.ventas, esHoy: r.es_hoy }));
}

// Hoy y la semana de cada sucursal, lado a lado.
async function comparacion() {
  const { rows } = await consultar(
    `WITH v AS (${ventas("date_trunc('week', now())")})
     SELECT s.id_sucursal, s.nombre,
            coalesce(sum(v.total) FILTER (WHERE v.fecha_hora >= date_trunc('day', now())), 0) AS hoy_total,
            count(v.id_venta) FILTER (WHERE v.fecha_hora >= date_trunc('day', now()))::int AS hoy_ventas,
            coalesce(sum(v.total), 0) AS semana_total,
            count(v.id_venta)::int AS semana_ventas
       FROM sucursales s
       LEFT JOIN v ON v.id_sucursal = s.id_sucursal
      WHERE s.activa
      GROUP BY s.id_sucursal, s.nombre
      ORDER BY s.nombre`,
    [null]
  );
  return rows.map((r) => ({ ...r, hoy_total: Number(r.hoy_total), semana_total: Number(r.semana_total) }));
}

// Ultimos 7 dias: como pagan, por donde compran y lo mas vendido.
const ULTIMOS_7 = 'current_date - 6';

async function ultimaSemana(idSucursal) {
  const { rows: medios } = await consultar(
    `SELECT m.nombre, coalesce(sum(p.monto), 0) AS total
       FROM medios_pago m
       LEFT JOIN (pagos_venta p JOIN ventas v ON v.id_venta = p.id_venta
                   AND v.fecha_anulacion IS NULL AND v.tipo_venta = 'MINORISTA'
                   AND v.id_sucursal = $1 AND v.fecha_hora >= ${ULTIMOS_7})
              ON p.id_medio_pago = m.id_medio_pago
      WHERE m.activo
      GROUP BY m.id_medio_pago, m.nombre
      ORDER BY m.id_medio_pago`,
    [idSucursal]
  );
  const CANALES = { MOSTRADOR: 'Mostrador', TELEFONO: 'Teléfono', PEDIDOSYA: 'PedidosYa' };
  const { rows: canales } = await consultar(
    `WITH v AS (${ventas(ULTIMOS_7)}) SELECT canal_venta, coalesce(sum(total), 0) AS total, count(*)::int AS ventas FROM v GROUP BY canal_venta`,
    [idSucursal]
  );
  const porCanal = Object.keys(CANALES).map((c) => {
    const f = canales.find((x) => x.canal_venta === c);
    return { nombre: CANALES[c], total: f ? Number(f.total) : 0, ventas: f ? f.ventas : 0 };
  });
  const { rows: masVendidos } = await consultar(
    `SELECT p.nombre, lower(u.abreviatura) AS unidad,
            sum(d.cantidad) AS cantidad, sum(d.cantidad * d.precio_unitario_aplicado) AS total
       FROM venta_detalle d
       JOIN ventas v ON v.id_venta = d.id_venta
       JOIN productos p ON p.id_producto = d.id_producto
       JOIN unidades_medida u ON u.id_unidad = p.id_unidad_medida
      WHERE v.fecha_anulacion IS NULL AND v.tipo_venta = 'MINORISTA'
        AND v.id_sucursal = $1 AND v.fecha_hora >= ${ULTIMOS_7}
      GROUP BY p.id_producto, p.nombre, u.abreviatura
      ORDER BY total DESC, p.nombre
      LIMIT 10`,
    [idSucursal]
  );
  return {
    medios: medios.map((m) => ({ nombre: m.nombre, total: Number(m.total) })),
    canales: porCanal,
    masVendidos: masVendidos.map((m) => ({ ...m, cantidad: Number(m.cantidad), total: Number(m.total) })),
  };
}

// Horas pico: lo vendido en cada hora del dia y en cada dia de la semana,
// en promedio, en las ultimas 4 semanas (28 dias, sin contar hoy).
async function horasPico(idSucursal) {
  const parametros = [idSucursal];
  const { rows: horas } = await consultar(
    `WITH v AS (${ventas('current_date - 28')} AND v.fecha_hora < current_date)
     SELECT extract(hour FROM fecha_hora)::int AS hora, sum(total) / 28 AS promedio
       FROM v GROUP BY 1 ORDER BY 1`,
    parametros
  );
  const { rows: dias } = await consultar(
    `WITH v AS (${ventas('current_date - 28')} AND v.fecha_hora < current_date)
     SELECT extract(isodow FROM fecha_hora)::int AS dia, sum(total) / 4 AS promedio
       FROM v GROUP BY 1 ORDER BY 1`,
    parametros
  );
  const NOMBRES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  // Del primer al ultimo horario con ventas, con las horas del medio en cero.
  // El dia de la heladeria arranca a la manana y termina pasada la
  // medianoche (el turno Tarde/Noche cierra a la 1): las horas se ordenan
  // desde las 6, asi la 0 y la 1 quedan al final y no del otro lado de un
  // hueco vacio. Van del primer al ultimo horario con ventas, con las horas
  // del medio en cero.
  const orden = (h) => (h + 18) % 24;
  let porHora = [];
  if (horas.length > 0) {
    const claves = horas.map((x) => orden(x.hora));
    for (let k = Math.min(...claves); k <= Math.max(...claves); k++) {
      const h = (k + 6) % 24;
      const f = horas.find((x) => x.hora === h);
      porHora.push({ hora: h, promedio: f ? Number(f.promedio) : 0 });
    }
  }
  const porDia = NOMBRES.map((nombre, i) => {
    const f = dias.find((x) => x.dia === i + 1);
    return { nombre, promedio: f ? Number(f.promedio) : 0 };
  });
  return { porHora, porDia };
}

// Control de caja de los ultimos 7 dias: ventas anuladas y cierres con
// diferencia entre lo que se conto y lo que calculo el sistema.
async function controlDeCaja(idSucursal) {
  const NOMBRE = (col) => `(SELECT concat_ws(' ', e.nombre, e.apellido) FROM usuarios u JOIN empleados e ON e.id_empleado = u.id_empleado WHERE u.id_usuario = ${col})`;
  const { rows: anuladas } = await consultar(
    `SELECT v.id_venta, v.fecha_hora, v.fecha_anulacion, v.motivo_anulacion,
            ${NOMBRE('v.id_usuario')} AS vendio, ${NOMBRE('v.id_usuario_anulacion')} AS anulo,
            (SELECT sum(d.cantidad * d.precio_unitario_aplicado) FROM venta_detalle d WHERE d.id_venta = v.id_venta) AS total
       FROM ventas v
      WHERE v.fecha_anulacion IS NOT NULL AND v.tipo_venta = 'MINORISTA'
        AND v.id_sucursal = $1 AND v.fecha_anulacion >= ${ULTIMOS_7}
      ORDER BY v.fecha_anulacion DESC`,
    [idSucursal]
  );
  const { rows: cierres } = await consultar(
    `SELECT c.id_caja, c.fecha_cierre, c.turno, c.monto_cierre_declarado AS declarado, c.monto_cierre_sistema AS sistema,
            c.monto_cierre_declarado - c.monto_cierre_sistema AS diferencia, ${NOMBRE('c.id_usuario_cierre')} AS cerro
       FROM cajas c
      WHERE c.id_sucursal = $1 AND c.fecha_cierre >= ${ULTIMOS_7}
      ORDER BY c.fecha_cierre DESC`,
    [idSucursal]
  );
  const conDiferencia = cierres.filter((c) => Number(c.diferencia) !== 0);
  return {
    anuladas: anuladas.map((a) => ({ ...a, total: Number(a.total) })),
    totalAnulado: anuladas.reduce((s, a) => s + Number(a.total), 0),
    cierres: cierres.length,
    conDiferencia: conDiferencia.map((c) => ({ ...c, declarado: Number(c.declarado), sistema: Number(c.sistema), diferencia: Number(c.diferencia) })),
  };
}

// Alertas de stock de helado en la sucursal.
async function alertasDeStock(idSucursal) {
  // Sabores que se estan vendiendo (tienen tacho en el pozo) y les queda un
  // tacho lleno o ninguno para reemplazarlo.
  const { rows: pocos } = await consultar(
    `SELECT s.nombre || ' (' || lower(s.linea) || ')' AS sabor,
            count(*) FILTER (WHERE t.estado = 'LLENO')::int AS llenos
       FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote JOIN sabores s ON s.id_sabor = l.id_sabor
      WHERE t.id_sucursal = $1 AND t.estado IN ('LLENO', 'EN_POZO')
      GROUP BY s.id_sabor, s.nombre, s.linea
     HAVING count(*) FILTER (WHERE t.estado = 'EN_POZO') > 0 AND count(*) FILTER (WHERE t.estado = 'LLENO') <= 1
      ORDER BY 2, 1`,
    [idSucursal]
  );
  // Tachos llenos o abiertos vencidos o que vencen en los proximos 30 dias.
  const { rows: porVencer } = await consultar(
    `SELECT s.nombre || ' (' || lower(s.linea) || ')' AS sabor, count(*)::int AS tachos, min(l.fecha_vencimiento) AS vence,
            min(l.fecha_vencimiento) < current_date AS vencido
       FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote JOIN sabores s ON s.id_sabor = l.id_sabor
      WHERE t.id_sucursal = $1 AND t.estado IN ('LLENO', 'EN_POZO') AND l.fecha_vencimiento <= current_date + 30
      GROUP BY s.id_sabor, s.nombre, s.linea
      ORDER BY 3, 1`,
    [idSucursal]
  );
  // Envios de los ultimos 30 dias, desde o hacia la sucursal, que llegaron con faltantes.
  const { rows: faltantes } = await consultar(
    `SELECT tr.id_traslado, tr.fecha_recepcion, so.nombre AS origen, sd.nombre AS destino,
            (SELECT count(*) FROM traslado_tachos tt WHERE tt.id_traslado = tr.id_traslado AND tt.recibido = false)::int AS tachos,
            (SELECT count(*) FROM traslado_productos tp WHERE tp.id_traslado = tr.id_traslado AND tp.cantidad_recibida < tp.cantidad)::int AS productos
       FROM traslados tr
       JOIN sucursales so ON so.id_sucursal = tr.id_sucursal_origen
       JOIN sucursales sd ON sd.id_sucursal = tr.id_sucursal_destino
      WHERE tr.estado = 'RECIBIDO' AND tr.fecha_recepcion >= current_date - 30
        AND $1 IN (tr.id_sucursal_origen, tr.id_sucursal_destino)
        AND (EXISTS (SELECT 1 FROM traslado_tachos tt WHERE tt.id_traslado = tr.id_traslado AND tt.recibido = false)
             OR EXISTS (SELECT 1 FROM traslado_productos tp WHERE tp.id_traslado = tr.id_traslado AND tp.cantidad_recibida < tp.cantidad))
      ORDER BY tr.fecha_recepcion DESC`,
    [idSucursal]
  );
  return { pocos, porVencer, faltantes };
}

async function metricasDelDueno(idSucursal) {
  const [resumen, dias, sucursales, semana, pico, control, alertas] = await Promise.all([
    periodos(idSucursal), ultimosDias(idSucursal), comparacion(), ultimaSemana(idSucursal),
    horasPico(idSucursal), controlDeCaja(idSucursal), alertasDeStock(idSucursal),
  ]);
  return { resumen, dias, sucursales, semana, pico, control, alertas };
}

module.exports = { metricasDelDueno, alertasDeStock };
