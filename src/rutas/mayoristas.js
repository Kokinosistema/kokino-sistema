'use strict';

const express = require('express');
const { consultar } = require('../db');
const { exigirRol } = require('../middleware/sesion');
const { parsearMonto, MONTO_INVALIDO, aCentavos, pesos } = require('../dinero');

const router = express.Router();

// Lo de cada cliente mayorista despues de venderle: su ficha, cuenta y
// envases, las estadisticas, y cada venta con su remito, cobros y anulacion.
// Va dentro de "Clientes mayoristas" y, como esa solapa, es solo de los
// duenos. Se vende desde Cotizar (src/rutas/cotizar.js), que desde el
// 2026-10-22 reemplaza a la venta mayorista de antes. Se monta en /clientes
// antes que el router de clientes, para que sus direcciones
// (/clientes/estadisticas, ...) no las tome el /:id de clientes.
router.use(exigirRol('administrador'));

const ENVASES = [
  { valor: 'RETORNABLE', texto: 'Envase retornable', ayuda: 'el cliente devuelve el tacho cuando lo termina' },
  { valor: 'INCLUIDO', texto: 'Envase incluido', ayuda: 'el cliente se queda con el tacho' },
];
const PAGOS = [
  { valor: 'AHORA', texto: 'Pagó ahora' },
  { valor: 'CUENTA', texto: 'Queda a cuenta' },
];

// ---------------------------------------------------------------------------
// Clientes, cuenta y stock

const NOMBRE_USUARIO = (col) => `(SELECT concat_ws(' ', e.nombre, e.apellido) FROM usuarios u
  JOIN empleados e ON e.id_empleado = u.id_empleado WHERE u.id_usuario = ${col})`;

async function traerCliente(id) {
  if (!Number.isInteger(id)) return null;
  const { rows: [c] } = await consultar(
    "SELECT * FROM clientes WHERE id_cliente = $1 AND tipo_cliente = 'MAYORISTA'", [id]
  );
  return c || null;
}

// Lo que debe el cliente (ventas no anuladas menos lo cobrado), cuanto de eso
// esta vencido segun su plazo de pago, y cuantos envases retornables tiene
// sin devolver.
async function cuentaDe(cliente) {
  const { rows: [r] } = await consultar(
    `WITH v AS (
       SELECT vt.id_venta, vt.fecha_hora, vt.total,
              vt.total - coalesce((SELECT sum(p.monto) FROM pagos_venta p WHERE p.id_venta = vt.id_venta), 0) AS saldo
         FROM ventas_totales vt
        WHERE vt.id_cliente = $1 AND vt.tipo_venta = 'MAYORISTA' AND NOT vt.anulada
     )
     SELECT coalesce(sum(saldo), 0) AS deuda,
            coalesce(sum(saldo) FILTER (WHERE $2::int IS NOT NULL AND fecha_hora::date + $2::int < current_date), 0) AS vencido,
            (SELECT count(*) FROM venta_tachos vt JOIN ventas ve ON ve.id_venta = vt.id_venta
              WHERE ve.id_cliente = $1 AND ve.fecha_anulacion IS NULL AND vt.envase = 'RETORNABLE')::int
            - (SELECT coalesce(sum(cantidad), 0) FROM devoluciones_envases d
                WHERE d.id_cliente = $1 AND d.fecha_anulacion IS NULL)::int AS envases
       FROM v`,
    [cliente.id_cliente, cliente.plazo_pago_dias]
  );
  return { deuda: Number(r.deuda), vencido: Number(r.vencido), envases: r.envases };
}

// Los de siempre, mas los atados a la venta mayorista si alguna vez hay uno.
// "PedidosYa (online)" no aparece aca: es solo para ventas de PedidosYa.
async function mediosDePago() {
  const { rows } = await consultar(
    "SELECT id_medio_pago, nombre FROM medios_pago WHERE activo AND (solo_canal IS NULL OR solo_canal = 'MAYORISTA') ORDER BY id_medio_pago"
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Estadisticas (pedidas por el dueno el 2026-10-05): que sabores compra cada
// mayorista, cual mas y cual menos, cuantos tachos por mes, y el total de
// los mayoristas para prever que fabricar. Salen de los tachos de cada venta
// no anulada (venta_tachos -> tacho -> lote -> sabor). El importe de cada
// tacho incluye el envase, si lo compro: es plata que el cliente pago.

const TACHOS_VENDIDOS = `
  SELECT v.id_venta, v.id_cliente, v.fecha_hora, l.id_sabor, vt.precio_aplicado + vt.precio_envase AS importe
    FROM venta_tachos vt
    JOIN ventas v ON v.id_venta = vt.id_venta
    JOIN tachos t ON t.id_tacho = vt.id_tacho
    JOIN lotes l ON l.id_lote = t.id_lote
   WHERE v.fecha_anulacion IS NULL AND v.tipo_venta = 'MAYORISTA'`;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Tachos de cada uno de los ultimos 12 meses (los meses sin compras en cero).
// $1 = cliente, o null para todos.
async function tachosPorMes(idCliente) {
  const { rows } = await consultar(
    `WITH t AS (${TACHOS_VENDIDOS} AND ($1::int IS NULL OR v.id_cliente = $1))
     SELECT m::date AS mes, count(t.id_venta)::int AS tachos, coalesce(sum(t.importe), 0) AS total,
            m = date_trunc('month', now()) AS es_actual
       FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
       LEFT JOIN t ON date_trunc('month', t.fecha_hora) = m
      GROUP BY m ORDER BY m`,
    [idCliente]
  );
  return rows.map((r) => ({
    mes: MESES[r.mes.getMonth()] + (r.mes.getMonth() === 0 ? ' ' + String(r.mes.getFullYear()).slice(2) : ''),
    tachos: r.tachos, total: Number(r.total), esActual: r.es_actual,
  }));
}

async function estadisticasDelCliente(idCliente) {
  const meses = await tachosPorMes(idCliente);
  // Sus sabores de los ultimos 12 meses, de mas a menos.
  const { rows: sabores } = await consultar(
    `WITH t AS (${TACHOS_VENDIDOS} AND v.id_cliente = $1 AND v.fecha_hora >= date_trunc('month', now()) - interval '11 months')
     SELECT s.nombre || ' (' || lower(s.linea) || ')' AS sabor, count(*)::int AS tachos,
            max(t.fecha_hora) AS ultima
       FROM t JOIN sabores s ON s.id_sabor = t.id_sabor
      GROUP BY s.id_sabor, s.nombre, s.linea
      ORDER BY tachos DESC, ultima DESC`,
    [idCliente]
  );
  // Cada cuanto compra: dias entre una compra y la siguiente, en promedio.
  const { rows: [frecuencia] } = await consultar(
    `WITH c AS (
       SELECT fecha_hora, lag(fecha_hora) OVER (ORDER BY fecha_hora) AS anterior
         FROM ventas
        WHERE id_cliente = $1 AND tipo_venta = 'MAYORISTA' AND fecha_anulacion IS NULL
     )
     SELECT count(*)::int AS compras, max(fecha_hora) AS ultima,
            (current_date - max(fecha_hora)::date) AS dias_desde,
            round(avg(extract(epoch FROM fecha_hora - anterior) / 86400))::int AS cada_dias
       FROM c`,
    [idCliente]
  );
  const totalSabores = sabores.reduce((s, x) => s + x.tachos, 0);
  return {
    meses,
    esteMes: meses[meses.length - 1],
    mesPasado: meses[meses.length - 2],
    sabores: sabores.map((x) => ({ ...x, porcentaje: totalSabores > 0 ? Math.round((x.tachos / totalSabores) * 100) : 0 })),
    frecuencia,
  };
}

// ---------------------------------------------------------------------------
// Que fabricar para los mayoristas (pedido por un dueno el 2026-10-16: "tener
// previsibilidad a la hora de preparar y de fabricar").
//
// Es un promedio, no una prediccion: con las compras de los ultimos 6 meses
// de cada cliente se saca cada cuanto compra (de la primera a la ultima,
// dividido por los intervalos) y cuantos tachos lleva por compra. Siguiendo
// ese ritmo desde su ultima compra, se cuentan las compras que caen en el
// plazo elegido. Lo esperado de cada cliente se reparte entre sabores segun
// la parte que compra de cada uno.
//
// Quedan afuera, y se avisa: el que tiene una sola compra (no hay ritmo) y
// el que lleva mas del doble de su ritmo sin comprar (probablemente dejo de
// comprar o compra en otro lado).

const PLAZOS = [7, 14, 30];
const PLAZO_PREDETERMINADO = 14;

const COMPRAS_RECIENTES = `
  t AS (${TACHOS_VENDIDOS} AND v.fecha_hora >= now() - interval '6 months'),
  compras AS (SELECT id_venta, id_cliente, min(fecha_hora) AS fecha, count(*) AS tachos FROM t GROUP BY id_venta, id_cliente),
  ritmo AS (
    SELECT id_cliente, count(*)::int AS compras, max(fecha) AS ultima, avg(tachos) AS por_compra,
           CASE WHEN count(*) > 1
                THEN greatest(1, extract(epoch FROM max(fecha) - min(fecha)) / 86400 / (count(*) - 1)) END AS cada,
           extract(epoch FROM now() - max(fecha)) / 86400 AS desde
      FROM compras GROUP BY id_cliente),
  esperado AS (
    SELECT r.*,
           CASE WHEN r.cada IS NULL THEN 'POCAS_COMPRAS'
                WHEN r.desde > 2 * r.cada THEN 'NO_VUELVE'
                ELSE 'ESTIMADO' END AS estado,
           CASE WHEN r.cada IS NOT NULL AND r.desde <= 2 * r.cada
                THEN floor((r.desde + $1) / r.cada) * r.por_compra ELSE 0 END AS tachos
      FROM ritmo r)`;

// El pronostico de cada cliente con compras recientes. $2 = un cliente, o
// null para todos.
async function pronosticoPorCliente(dias, idCliente) {
  const { rows } = await consultar(
    `WITH ${COMPRAS_RECIENTES}
     SELECT e.id_cliente, c.nombre_razon_social, e.compras, e.estado, e.tachos AS esperados,
            round(e.cada)::int AS cada_dias, floor(e.desde)::int AS dias_desde, e.por_compra,
            (e.ultima + e.cada * interval '1 day')::date AS proxima,
            (e.ultima + e.cada * interval '1 day')::date < current_date AS atrasado
       FROM esperado e JOIN clientes c ON c.id_cliente = e.id_cliente
      WHERE c.activo AND ($2::int IS NULL OR e.id_cliente = $2)
      ORDER BY e.tachos DESC, c.nombre_razon_social`,
    [dias, idCliente]
  );
  return rows.map((r) => ({ ...r, esperados: Number(r.esperados), por_compra: Number(r.por_compra) }));
}

// Los tachos esperados de cada sabor contra los llenos de hoy en la fabrica,
// que es de donde salen las ventas mayoristas. Se redondea para arriba: para
// fabricar, mejor que sobre a que falte.
async function pronosticoPorSabor(dias) {
  const { rows } = await consultar(
    `WITH ${COMPRAS_RECIENTES},
          parte AS (SELECT id_cliente, id_sabor, count(*)::numeric / sum(count(*)) OVER (PARTITION BY id_cliente) AS parte
                      FROM t GROUP BY id_cliente, id_sabor),
          fabrica AS (SELECT id_sucursal FROM sucursales WHERE tiene_fabrica AND activa ORDER BY id_sucursal LIMIT 1),
          por_sabor AS (
            SELECT s.nombre || ' (' || lower(s.linea) || ')' AS sabor, s.linea,
                   ceil(sum(e.tachos * p.parte))::int AS esperados,
                   (SELECT count(*) FROM tachos tt JOIN lotes ll ON ll.id_lote = tt.id_lote
                     WHERE ll.id_sabor = s.id_sabor AND tt.estado = 'LLENO'
                       AND tt.id_sucursal = (SELECT id_sucursal FROM fabrica))::int AS llenos
              FROM parte p
              JOIN esperado e ON e.id_cliente = p.id_cliente
              JOIN clientes c ON c.id_cliente = p.id_cliente AND c.activo
              JOIN sabores s ON s.id_sabor = p.id_sabor
             GROUP BY s.id_sabor, s.nombre, s.linea
            HAVING sum(e.tachos * p.parte) > 0)
     -- Primero lo que mas falta fabricar.
     SELECT * FROM por_sabor ORDER BY esperados - llenos DESC, sabor`,
    [dias]
  );
  return rows.map((r) => ({ ...r, fabricar: Math.max(0, r.esperados - r.llenos) }));
}

// Todos los mayoristas juntos: los sabores que mas piden (para fabricar) y
// como viene cada cliente.
router.get('/estadisticas', async (req, res, siguiente) => {
  try {
    const meses = await tachosPorMes(null);
    // Ultimos 3 meses completos mas el actual, con el stock lleno de hoy en
    // la sucursal con fabrica, que es de donde salen.
    const { rows: sabores } = await consultar(
      `WITH t AS (${TACHOS_VENDIDOS} AND v.fecha_hora >= date_trunc('month', now()) - interval '3 months'),
            fabrica AS (SELECT id_sucursal FROM sucursales WHERE tiene_fabrica AND activa ORDER BY id_sucursal LIMIT 1)
       SELECT s.nombre || ' (' || lower(s.linea) || ')' AS sabor,
              count(*)::int AS tachos,
              count(*) FILTER (WHERE t.fecha_hora >= date_trunc('month', now()))::int AS este_mes,
              count(DISTINCT t.id_cliente)::int AS clientes,
              (SELECT count(*) FROM tachos tt JOIN lotes ll ON ll.id_lote = tt.id_lote
                WHERE ll.id_sabor = s.id_sabor AND tt.estado = 'LLENO'
                  AND tt.id_sucursal = (SELECT id_sucursal FROM fabrica))::int AS llenos
         FROM t JOIN sabores s ON s.id_sabor = t.id_sabor
        GROUP BY s.id_sabor, s.nombre, s.linea
        ORDER BY tachos DESC, s.nombre`
    );
    const { rows: [fabrica] } = await consultar('SELECT nombre FROM sucursales WHERE tiene_fabrica AND activa ORDER BY id_sucursal LIMIT 1');
    const { rows: clientes } = await consultar(
      `WITH t AS (${TACHOS_VENDIDOS})
       SELECT c.id_cliente, c.nombre_razon_social,
              count(t.id_venta) FILTER (WHERE t.fecha_hora >= date_trunc('month', now()))::int AS este_mes,
              count(t.id_venta) FILTER (WHERE t.fecha_hora >= date_trunc('month', now()) - interval '1 month'
                                          AND t.fecha_hora < date_trunc('month', now()))::int AS mes_pasado,
              coalesce(sum(t.importe) FILTER (WHERE t.fecha_hora >= date_trunc('month', now())), 0) AS total_mes,
              max(t.fecha_hora) AS ultima
         FROM clientes c
         LEFT JOIN t ON t.id_cliente = c.id_cliente
        WHERE c.tipo_cliente = 'MAYORISTA' AND c.activo
        GROUP BY c.id_cliente, c.nombre_razon_social
        ORDER BY este_mes DESC, mes_pasado DESC, c.nombre_razon_social`
    );
    // El plazo del pronostico sale de la direccion (?dias=7); cualquier otra
    // cosa usa el predeterminado.
    const dias = PLAZOS.includes(Number(req.query.dias)) ? Number(req.query.dias) : PLAZO_PREDETERMINADO;
    res.render('mayoristas/estadisticas', {
      meses, sabores, clientes: clientes.map((c) => ({ ...c, total_mes: Number(c.total_mes) })),
      fabrica: fabrica ? fabrica.nombre : null,
      pronostico: { dias, PLAZOS, clientes: await pronosticoPorCliente(dias, null), sabores: await pronosticoPorSabor(dias) },
    });
  } catch (error) {
    siguiente(error);
  }
});

// ---------------------------------------------------------------------------
// Ficha del cliente

router.get('/:id', async (req, res, siguiente) => {
  try {
    const cliente = await traerCliente(Number(req.params.id));
    if (!cliente) return siguiente();
    const cuenta = await cuentaDe(cliente);
    const { rows: ventas } = await consultar(
      `SELECT vt.id_venta, vt.fecha_hora, vt.total, vt.anulada, s.nombre AS sucursal,
              vt.total - coalesce((SELECT sum(p.monto) FROM pagos_venta p WHERE p.id_venta = vt.id_venta), 0) AS saldo,
              (SELECT count(*) FROM venta_tachos t WHERE t.id_venta = vt.id_venta)::int AS tachos
         FROM ventas_totales vt
         JOIN ventas v ON v.id_venta = vt.id_venta
         JOIN sucursales s ON s.id_sucursal = v.id_sucursal
        WHERE vt.id_cliente = $1 AND vt.tipo_venta = 'MAYORISTA'
        ORDER BY vt.fecha_hora DESC
        LIMIT 50`,
      [cliente.id_cliente]
    );
    const { rows: devoluciones } = await consultar(
      `SELECT d.id_devolucion, d.cantidad, d.fecha_hora, d.observaciones, d.fecha_anulacion, d.motivo_anulacion,
              ${NOMBRE_USUARIO('d.id_usuario')} AS quien
         FROM devoluciones_envases d
        WHERE d.id_cliente = $1
        ORDER BY d.fecha_hora DESC
        LIMIT 20`,
      [cliente.id_cliente]
    );
    const estadisticas = await estadisticasDelCliente(cliente.id_cliente);
    [estadisticas.pronostico] = await pronosticoPorCliente(PLAZO_PREDETERMINADO, cliente.id_cliente);
    res.render('mayoristas/ficha', { cliente, cuenta, ventas, devoluciones, estadisticas, errores: [] });
  } catch (error) {
    siguiente(error);
  }
});

// ---------------------------------------------------------------------------
// Una venta: remito, cobros y anulacion

async function traerVenta(id) {
  if (!Number.isInteger(id)) return null;
  const { rows: [venta] } = await consultar(
    `SELECT v.id_venta, v.fecha_hora, v.id_sucursal, v.fecha_anulacion, v.motivo_anulacion,
            s.nombre AS sucursal, vt.total, ${NOMBRE_USUARIO('v.id_usuario')} AS vendio,
            ${NOMBRE_USUARIO('v.id_usuario_anulacion')} AS anulo,
            c.id_cliente, c.nombre_razon_social, c.cuit, c.direccion, c.telefono, c.plazo_pago_dias
       FROM ventas v
       JOIN ventas_totales vt ON vt.id_venta = v.id_venta
       JOIN sucursales s ON s.id_sucursal = v.id_sucursal
       JOIN clientes c ON c.id_cliente = v.id_cliente
      WHERE v.id_venta = $1 AND v.tipo_venta = 'MAYORISTA'`,
    [id]
  );
  if (!venta) return null;
  venta.total = Number(venta.total);
  const { rows: tachos } = await consultar(
    `SELECT vt.envase, vt.precio_aplicado, vt.precio_envase, t.codigo_barras, s.nombre || ' (' || lower(s.linea) || ')' AS sabor
       FROM venta_tachos vt
       JOIN tachos t ON t.id_tacho = vt.id_tacho
       JOIN lotes l ON l.id_lote = t.id_lote
       JOIN sabores s ON s.id_sabor = l.id_sabor
      WHERE vt.id_venta = $1
      ORDER BY s.nombre, s.linea, vt.envase, vt.precio_aplicado, t.codigo_barras`,
    [id]
  );
  // Agrupados por sabor, envase y precio para el remito.
  const renglones = [];
  for (const t of tachos) {
    let r = renglones.find((x) => x.sabor === t.sabor && x.envase === t.envase && aCentavos(x.precio) === aCentavos(t.precio_aplicado));
    if (!r) { r = { sabor: t.sabor, envase: t.envase, precio: Number(t.precio_aplicado), cantidad: 0, codigos: [] }; renglones.push(r); }
    r.cantidad += 1;
    r.codigos.push(t.codigo_barras);
  }
  // Los envases cobrados aparte van en su propio renglon del remito. Las
  // ventas anteriores al 2026-10-22 no tienen: su envase venia en el precio.
  const conEnvase = tachos.filter((t) => Number(t.precio_envase) > 0);
  const envases = {
    cantidad: conEnvase.length,
    precio: conEnvase.length > 0 ? Number(conEnvase[0].precio_envase) : 0,
    total: conEnvase.reduce((s, t) => s + aCentavos(t.precio_envase), 0) / 100,
  };
  const { rows: cobros } = await consultar(
    `SELECT p.monto, p.fecha_hora, m.nombre AS medio, ${NOMBRE_USUARIO('p.id_usuario')} AS quien
       FROM pagos_venta p JOIN medios_pago m ON m.id_medio_pago = p.id_medio_pago
      WHERE p.id_venta = $1 ORDER BY p.fecha_hora`,
    [id]
  );
  const cobrado = cobros.reduce((s, c) => s + aCentavos(c.monto), 0) / 100;
  return { venta, renglones, envases, cobros, cobrado, saldo: (aCentavos(venta.total) - aCentavos(cobrado)) / 100 };
}

async function mostrarVenta(res, datos, { errores = [], estado = 200, valores = {} } = {}) {
  res.status(estado).render('mayoristas/venta', { ...datos, ENVASES, medios: await mediosDePago(), errores, valores });
}

router.get('/ventas/:id', async (req, res, siguiente) => {
  try {
    const datos = await traerVenta(Number(req.params.id));
    if (!datos) return siguiente();
    await mostrarVenta(res, datos);
  } catch (error) {
    siguiente(error);
  }
});

// Cobrar lo que quedo debiendo, en una o varias veces.
router.post('/ventas/:id/cobros', async (req, res, siguiente) => {
  try {
    const datos = await traerVenta(Number(req.params.id));
    if (!datos) return siguiente();
    const valores = { monto: (req.body.monto || '').trim(), id_medio_pago: req.body.id_medio_pago || '' };
    const errores = [];
    if (datos.venta.fecha_anulacion) errores.push('La venta está anulada: no se le cobra.');
    else if (datos.saldo <= 0) errores.push('La venta ya está paga.');
    const monto = parsearMonto(valores.monto);
    if (errores.length === 0) {
      if (monto === null) errores.push('Poné cuánto pagó: ' + MONTO_INVALIDO + '.');
      else if (aCentavos(monto) > aCentavos(datos.saldo)) errores.push('Debe ' + pesos(datos.saldo) + ' de esta venta: no se le puede cobrar más.');
      if (!(await mediosDePago()).some((m) => m.id_medio_pago === Number(valores.id_medio_pago))) errores.push('Elegí con qué pagó.');
    }
    if (errores.length > 0) return mostrarVenta(res, datos, { errores, valores, estado: 400 });
    await consultar('INSERT INTO pagos_venta (id_venta, id_medio_pago, id_usuario, monto) VALUES ($1, $2, $3, $4)',
      [datos.venta.id_venta, Number(valores.id_medio_pago), req.session.usuario.id_usuario, monto]);
    const queda = (aCentavos(datos.saldo) - aCentavos(monto)) / 100;
    req.session.aviso = 'Se registró el cobro. ' + (queda > 0 ? 'Todavía debe ' + pesos(queda) + ' de esta venta.' : 'La venta quedó paga.');
    res.redirect('/clientes/ventas/' + datos.venta.id_venta);
  } catch (error) {
    siguiente(error);
  }
});

// Anular: los tachos vuelven al stock (lo hace la base). Los cobros quedan
// registrados: si se habia cobrado, la plata se devuelve por fuera.
router.post('/ventas/:id/anular', async (req, res, siguiente) => {
  try {
    const datos = await traerVenta(Number(req.params.id));
    if (!datos) return siguiente();
    const motivo = (req.body.motivo || '').trim().slice(0, 300);
    if (datos.venta.fecha_anulacion) {
      req.session.aviso = 'La venta ya estaba anulada.';
    } else if (!motivo) {
      req.session.aviso = 'Para anular la venta escribí el motivo.';
    } else {
      await consultar(
        'UPDATE ventas SET fecha_anulacion = now(), id_usuario_anulacion = $1, motivo_anulacion = $2 WHERE id_venta = $3',
        [req.session.usuario.id_usuario, motivo, datos.venta.id_venta]
      );
      req.session.aviso = 'Se anuló la venta N° ' + datos.venta.id_venta + '. Sus tachos volvieron al stock de ' + datos.venta.sucursal + '.'
        + (datos.cobrado > 0 ? ' Se habían cobrado ' + pesos(datos.cobrado) + ': esa plata se devuelve por fuera del sistema.' : '');
    }
    res.redirect('/clientes/ventas/' + datos.venta.id_venta);
  } catch (error) {
    siguiente(error);
  }
});

// ---------------------------------------------------------------------------
// Devolucion de envases retornables

router.post('/:id/devoluciones', async (req, res, siguiente) => {
  try {
    const cliente = await traerCliente(Number(req.params.id));
    if (!cliente) return siguiente();
    const { envases } = await cuentaDe(cliente);
    const texto = (req.body.cantidad || '').trim();
    const observaciones = (req.body.observaciones || '').trim().slice(0, 300);
    if (!/^\d{1,3}$/.test(texto) || Number(texto) < 1) {
      req.session.aviso = 'Poné cuántos envases devolvió (un número entero).';
    } else if (Number(texto) > envases) {
      req.session.aviso = cliente.nombre_razon_social + (envases === 0 ? ' no tiene envases para devolver.' : ' tiene ' + envases + (envases === 1 ? ' envase' : ' envases') + ' sin devolver: no puede devolver ' + texto + '.');
    } else {
      await consultar('INSERT INTO devoluciones_envases (id_cliente, cantidad, id_usuario, observaciones) VALUES ($1, $2, $3, $4)',
        [cliente.id_cliente, Number(texto), req.session.usuario.id_usuario, observaciones || null]);
      const quedan = envases - Number(texto);
      req.session.aviso = 'Se registró la devolución. ' + (quedan === 0 ? 'Ya no debe envases.' : quedan === 1 ? 'Le queda 1 envase por devolver.' : 'Le quedan ' + quedan + ' envases por devolver.');
    }
    res.redirect('/clientes/' + cliente.id_cliente + '#envases');
  } catch (error) {
    siguiente(error);
  }
});

router.post('/devoluciones/:id/anular', async (req, res, siguiente) => {
  try {
    const { rows: [d] } = await consultar('SELECT id_cliente, fecha_anulacion FROM devoluciones_envases WHERE id_devolucion = $1', [Number(req.params.id)]);
    if (!d) return siguiente();
    const motivo = (req.body.motivo || '').trim().slice(0, 300);
    if (d.fecha_anulacion) req.session.aviso = 'Esa devolución ya estaba anulada.';
    else if (!motivo) req.session.aviso = 'Para anular la devolución escribí el motivo.';
    else {
      await consultar(
        'UPDATE devoluciones_envases SET fecha_anulacion = now(), id_usuario_anulacion = $1, motivo_anulacion = $2 WHERE id_devolucion = $3',
        [req.session.usuario.id_usuario, motivo, Number(req.params.id)]
      );
      req.session.aviso = 'Se anuló la devolución: esos envases vuelven a figurar como no devueltos.';
    }
    res.redirect('/clientes/' + d.id_cliente + '#envases');
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
module.exports.ENVASES = ENVASES;
module.exports.PAGOS = PAGOS;
module.exports.traerCliente = traerCliente;
module.exports.cuentaDe = cuentaDe;
module.exports.mediosDePago = mediosDePago;
