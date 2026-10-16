'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { exigirRol } = require('../middleware/sesion');
const { parsearMonto, MONTO_INVALIDO, aCentavos, pesos } = require('../dinero');

const router = express.Router();

// Venta mayorista de tachos (definida con la usuaria el 2026-10-05). Va
// dentro de "Clientes mayoristas" y, como esa solapa, es solo de los duenos.
// Se monta en /clientes antes que el router de clientes, para que sus
// direcciones (/clientes/precios, ...) no las tome el /:id de clientes.
router.use(exigirRol('administrador'));

const LINEAS = [
  { valor: 'FAMILIAR', texto: 'Familiar' },
  { valor: 'ARTESANAL', texto: 'Artesanal' },
];
const ENVASES = [
  { valor: 'RETORNABLE', texto: 'Envase retornable', ayuda: 'el cliente devuelve el tacho cuando lo termina' },
  { valor: 'INCLUIDO', texto: 'Envase incluido', ayuda: 'el cliente se queda con el tacho' },
];

// Precio sugerido vigente de cada linea y envase: { 'FAMILIAR:RETORNABLE': {precio, desde} }.
async function preciosVigentes() {
  const { rows } = await consultar(
    `SELECT linea, envase, precio, fecha_vigencia_desde AS desde
       FROM precios_mayoristas WHERE fecha_vigencia_hasta IS NULL`
  );
  return Object.fromEntries(rows.map((r) => [r.linea + ':' + r.envase, { precio: Number(r.precio), desde: r.desde }]));
}

// ---------------------------------------------------------------------------
// Lista de precios mayoristas

async function mostrarPrecios(res, { valores = null, errores = [], estado = 200 } = {}) {
  const vigentes = await preciosVigentes();
  const { rows: historial } = await consultar(
    `SELECT pm.linea, pm.envase, pm.precio, pm.fecha_vigencia_desde AS desde, pm.fecha_vigencia_hasta AS hasta,
            concat_ws(' ', e.nombre, e.apellido) AS quien
       FROM precios_mayoristas pm
       JOIN usuarios u ON u.id_usuario = pm.id_usuario
       JOIN empleados e ON e.id_empleado = u.id_empleado
      ORDER BY pm.id_precio_mayorista DESC
      LIMIT 20`
  );
  res.status(estado).render('mayoristas/precios', { LINEAS, ENVASES, vigentes, valores, errores, historial });
}

router.get('/precios', async (req, res, siguiente) => {
  try {
    await mostrarPrecios(res);
  } catch (error) {
    siguiente(error);
  }
});

// Guarda solo los que cambiaron. Un precio nuevo cierra el anterior y rige
// desde hoy, como los precios de mostrador. Un campo vacio deja la linea sin
// precio sugerido si nunca tuvo; uno que ya tenia no se puede vaciar.
router.post('/precios', async (req, res, siguiente) => {
  try {
    const vigentes = await preciosVigentes();
    const valores = {};
    const errores = [];
    const cambios = [];
    for (const l of LINEAS) {
      for (const e of ENVASES) {
        const clave = l.valor + ':' + e.valor;
        const texto = typeof req.body[clave] === 'string' ? req.body[clave].trim() : '';
        valores[clave] = texto;
        const actual = vigentes[clave];
        if (texto === '') {
          if (actual) errores.push('El precio de ' + l.texto.toLowerCase() + ' con ' + e.texto.toLowerCase() + ' no se puede dejar vacío: poné el nuevo precio.');
          continue;
        }
        const precio = parsearMonto(texto);
        if (precio === null) {
          errores.push('El precio de ' + l.texto.toLowerCase() + ' con ' + e.texto.toLowerCase() + ': ' + MONTO_INVALIDO + '.');
          continue;
        }
        if (!actual || aCentavos(actual.precio) !== aCentavos(precio)) cambios.push({ linea: l.valor, envase: e.valor, precio });
      }
    }
    if (errores.length > 0) return mostrarPrecios(res, { valores, errores, estado: 400 });
    if (cambios.length === 0) {
      req.session.aviso = 'No había ningún precio para cambiar.';
      return res.redirect('/clientes/precios');
    }

    await conTransaccion(async (ejecutar) => {
      for (const c of cambios) {
        await ejecutar(
          `UPDATE precios_mayoristas SET fecha_vigencia_hasta = current_date
            WHERE linea = $1 AND envase = $2 AND fecha_vigencia_hasta IS NULL`,
          [c.linea, c.envase]
        );
        await ejecutar(
          'INSERT INTO precios_mayoristas (linea, envase, precio, id_usuario) VALUES ($1, $2, $3, $4)',
          [c.linea, c.envase, c.precio, req.session.usuario.id_usuario]
        );
      }
    });
    req.session.aviso = cambios.length === 1 ? 'Se guardó el precio nuevo. Rige desde hoy.' : 'Se guardaron ' + cambios.length + ' precios nuevos. Rigen desde hoy.';
    res.redirect('/clientes/precios');
  } catch (error) {
    siguiente(error);
  }
});

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

// Sabores con tachos llenos en la sucursal, con su linea para el precio sugerido.
async function saboresDisponibles(idSucursal) {
  const { rows } = await consultar(
    `SELECT s.id_sabor, s.nombre || ' (' || lower(s.linea) || ')' AS nombre, s.linea,
            count(*)::int AS llenos, min(l.fecha_vencimiento) AS vence
       FROM tachos t
       JOIN lotes l ON l.id_lote = t.id_lote
       JOIN sabores s ON s.id_sabor = l.id_sabor
      WHERE t.id_sucursal = $1 AND t.estado = 'LLENO'
      GROUP BY s.id_sabor, s.nombre, s.linea
      ORDER BY s.nombre, s.linea`,
    [idSucursal]
  );
  return rows;
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
// no anulada (venta_tachos -> tacho -> lote -> sabor).

const TACHOS_VENDIDOS = `
  SELECT v.id_venta, v.id_cliente, v.fecha_hora, l.id_sabor, vt.precio_aplicado
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
     SELECT m::date AS mes, count(t.id_venta)::int AS tachos, coalesce(sum(t.precio_aplicado), 0) AS total,
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
              coalesce(sum(t.precio_aplicado) FILTER (WHERE t.fecha_hora >= date_trunc('month', now())), 0) AS total_mes,
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
// Vender: armar, revisar y confirmar
//
// Lo elegido se guarda en la sesion mientras se revisa, como en Envios. Se
// vende desde la sucursal de trabajo: los tachos salen de ahi (los que vencen
// primero) y la base no deja vender uno que este en otra sucursal.

const PAGOS = [
  { valor: 'AHORA', texto: 'Pagó ahora' },
  { valor: 'CUENTA', texto: 'Queda a cuenta' },
];
const lista = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function borradorDe(req, cliente) {
  const b = req.session.ventaMayorista;
  return b && b.id_cliente === cliente.id_cliente && b.id_sucursal === req.sucursal.id_sucursal ? b : null;
}

// Controla lo elegido contra el stock y arma los renglones con numeros.
// Lo usan revisar y confirmar, asi lo que se guarda pasa por el mismo control.
async function controlarVenta(borrador, cliente, idSucursal) {
  const errores = [];
  const disponibles = await saboresDisponibles(idSucursal);
  const renglones = [];
  const pedidosPorSabor = {};
  borrador.renglones.forEach((r) => {
    const sabor = disponibles.find((s) => s.id_sabor === Number(r.id_sabor));
    if (!sabor) { errores.push('Un sabor elegido ya no tiene tachos llenos en esta sucursal: sacalo de la lista.'); return; }
    if (!/^\d{1,3}$/.test(r.cantidad) || Number(r.cantidad) < 1) { errores.push('La cantidad de ' + sabor.nombre + ' tiene que ser un número entero.'); return; }
    if (!ENVASES.some((e) => e.valor === r.envase)) { errores.push('Elegí el envase de ' + sabor.nombre + '.'); return; }
    const precio = parsearMonto(r.precio);
    if (precio === null) { errores.push('El precio por tacho de ' + sabor.nombre + ': ' + MONTO_INVALIDO + '.'); return; }
    pedidosPorSabor[sabor.id_sabor] = (pedidosPorSabor[sabor.id_sabor] || 0) + Number(r.cantidad);
    renglones.push({ id_sabor: sabor.id_sabor, sabor: sabor.nombre, envase: r.envase, cantidad: Number(r.cantidad), precio });
  });
  for (const [idSabor, pedidos] of Object.entries(pedidosPorSabor)) {
    const sabor = disponibles.find((s) => s.id_sabor === Number(idSabor));
    if (pedidos > sabor.llenos) errores.push('De ' + sabor.nombre + ' hay ' + sabor.llenos + (sabor.llenos === 1 ? ' tacho lleno' : ' tachos llenos') + ': no se pueden vender ' + pedidos + '.');
  }
  if (borrador.renglones.length === 0) errores.push('Agregá al menos un sabor.');
  if (!PAGOS.some((p) => p.valor === borrador.pago)) errores.push('Elegí si pagó ahora o queda a cuenta.');
  if (borrador.pago === 'AHORA' && !(await mediosDePago()).some((m) => m.id_medio_pago === Number(borrador.id_medio_pago))) {
    errores.push('Elegí con qué pagó.');
  }
  if (borrador.pago === 'CUENTA' && cliente.limite_cuenta_corriente === null) {
    errores.push(cliente.nombre_razon_social + ' no tiene cuenta corriente habilitada. Para venderle a cuenta, cargale un límite en Editar cliente.');
  }
  const total = renglones.reduce((s, r) => s + aCentavos(r.precio) * r.cantidad, 0) / 100;
  return { renglones, total, errores };
}

async function mostrarArmado(req, res, cliente, { borrador, errores = [], estado = 200 }) {
  res.status(estado).render('mayoristas/vender', {
    cliente, borrador, errores, ENVASES, PAGOS,
    sabores: await saboresDisponibles(req.sucursal.id_sucursal),
    precios: await preciosVigentes(),
    medios: await mediosDePago(),
    cuenta: await cuentaDe(cliente),
  });
}

router.get('/:id/vender', async (req, res, siguiente) => {
  try {
    const cliente = await traerCliente(Number(req.params.id));
    if (!cliente) return siguiente();
    if (!cliente.activo) {
      req.session.aviso = cliente.nombre_razon_social + ' está dado de baja: reactivalo para venderle.';
      return res.redirect('/clientes/' + cliente.id_cliente);
    }
    const borrador = borradorDe(req, cliente) || { renglones: [], pago: '', id_medio_pago: '', observaciones: '' };
    await mostrarArmado(req, res, cliente, { borrador });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/:id/vender', async (req, res, siguiente) => {
  try {
    const cliente = await traerCliente(Number(req.params.id));
    if (!cliente || !cliente.activo) return siguiente();
    if (Number(req.body.id_sucursal) !== req.sucursal.id_sucursal) {
      req.session.aviso = 'Cambiaste de sucursal mientras armabas la venta: revisala de nuevo.';
      return res.redirect('/clientes/' + cliente.id_cliente + '/vender');
    }
    const sabores = lista(req.body.renglon_sabor);
    const envases = lista(req.body.renglon_envase);
    const cantidades = lista(req.body.renglon_cantidad);
    const precios = lista(req.body.renglon_precio);
    const borrador = {
      id_cliente: cliente.id_cliente,
      id_sucursal: req.sucursal.id_sucursal,
      renglones: sabores.map((s, i) => ({
        id_sabor: String(s), envase: String(envases[i] || ''),
        cantidad: String(cantidades[i] || '').trim(), precio: String(precios[i] || '').trim(),
      })),
      pago: typeof req.body.pago === 'string' ? req.body.pago : '',
      id_medio_pago: typeof req.body.id_medio_pago === 'string' ? req.body.id_medio_pago : '',
      observaciones: (typeof req.body.observaciones === 'string' ? req.body.observaciones : '').trim().slice(0, 500),
    };
    req.session.ventaMayorista = borrador;
    const { errores } = await controlarVenta(borrador, cliente, req.sucursal.id_sucursal);
    if (errores.length > 0) return mostrarArmado(req, res, cliente, { borrador, errores, estado: 400 });
    res.redirect('/clientes/' + cliente.id_cliente + '/vender/revisar');
  } catch (error) {
    siguiente(error);
  }
});

router.get('/:id/vender/revisar', async (req, res, siguiente) => {
  try {
    const cliente = await traerCliente(Number(req.params.id));
    if (!cliente) return siguiente();
    const borrador = borradorDe(req, cliente);
    if (!borrador) return res.redirect('/clientes/' + cliente.id_cliente + '/vender');
    const control = await controlarVenta(borrador, cliente, req.sucursal.id_sucursal);
    if (control.errores.length > 0) return mostrarArmado(req, res, cliente, { borrador, errores: control.errores, estado: 400 });
    // Los tachos que saldrian: los que vencen primero de cada sabor.
    for (const r of control.renglones) {
      const ya = control.renglones.filter((x) => x.id_sabor === r.id_sabor && x !== r && control.renglones.indexOf(x) < control.renglones.indexOf(r))
        .reduce((s, x) => s + x.cantidad, 0);
      const { rows } = await consultar(
        `SELECT t.codigo_barras FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote
          WHERE t.id_sucursal = $1 AND t.estado = 'LLENO' AND l.id_sabor = $2
          ORDER BY l.fecha_vencimiento, t.id_tacho OFFSET $3 LIMIT $4`,
        [req.sucursal.id_sucursal, r.id_sabor, ya, r.cantidad]
      );
      r.codigos = rows.map((x) => x.codigo_barras);
    }
    const cuenta = await cuentaDe(cliente);
    const medio = (await mediosDePago()).find((m) => m.id_medio_pago === Number(borrador.id_medio_pago));
    res.render('mayoristas/revisar', {
      cliente, borrador, cuenta, ENVASES, ...control,
      medio: medio ? medio.nombre : '',
      superaLimite: borrador.pago === 'CUENTA' && cliente.limite_cuenta_corriente !== null
        && cuenta.deuda + control.total > Number(cliente.limite_cuenta_corriente),
      fecha: new Date(), vendio: req.session.usuario.nombre,
    });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/:id/vender/confirmar', async (req, res, siguiente) => {
  try {
    const cliente = await traerCliente(Number(req.params.id));
    if (!cliente) return siguiente();
    const borrador = borradorDe(req, cliente);
    if (!borrador) return res.redirect('/clientes/' + cliente.id_cliente + '/vender');
    const control = await controlarVenta(borrador, cliente, req.sucursal.id_sucursal);
    if (control.errores.length > 0) return mostrarArmado(req, res, cliente, { borrador, errores: control.errores, estado: 400 });

    const resultado = await conTransaccion(async (ejecutar) => {
      const { rows: [venta] } = await ejecutar(
        `INSERT INTO ventas (id_usuario, id_cliente, canal_venta, tipo_venta, id_sucursal)
         VALUES ($1, $2, 'MAYORISTA', 'MAYORISTA', $3) RETURNING id_venta`,
        [req.session.usuario.id_usuario, cliente.id_cliente, req.sucursal.id_sucursal]
      );
      const usados = [];
      for (const r of control.renglones) {
        // Los que vencen primero, tomados hasta el final de la transaccion.
        const { rows: tachos } = await ejecutar(
          `SELECT t.id_tacho FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote
            WHERE t.id_sucursal = $1 AND t.estado = 'LLENO' AND l.id_sabor = $2 AND NOT (t.id_tacho = ANY($3::int[]))
            ORDER BY l.fecha_vencimiento, t.id_tacho
            LIMIT $4
            FOR UPDATE OF t`,
          [req.sucursal.id_sucursal, r.id_sabor, usados, r.cantidad]
        );
        if (tachos.length < r.cantidad) return { error: 'Mientras revisabas se abrió, se envió o se vendió algún tacho de ' + r.sabor + ' y ya no alcanzan. Revisá las cantidades.' };
        for (const t of tachos) {
          usados.push(t.id_tacho);
          await ejecutar('INSERT INTO venta_tachos (id_venta, id_tacho, envase, precio_aplicado) VALUES ($1, $2, $3, $4)',
            [venta.id_venta, t.id_tacho, r.envase, r.precio]);
        }
      }
      if (borrador.pago === 'AHORA' && control.total > 0) {
        await ejecutar('INSERT INTO pagos_venta (id_venta, id_medio_pago, id_usuario, monto) VALUES ($1, $2, $3, $4)',
          [venta.id_venta, Number(borrador.id_medio_pago), req.session.usuario.id_usuario, control.total]);
      }
      return { id: venta.id_venta };
    });
    if (resultado.error) {
      req.session.aviso = resultado.error;
      return res.redirect('/clientes/' + cliente.id_cliente + '/vender');
    }
    delete req.session.ventaMayorista;
    req.session.aviso = 'Se registró la venta N° ' + resultado.id + ' a ' + cliente.nombre_razon_social + '. Imprimí el remito para que viaje con los tachos.';
    res.redirect('/clientes/ventas/' + resultado.id);
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
    `SELECT vt.envase, vt.precio_aplicado, t.codigo_barras, s.nombre || ' (' || lower(s.linea) || ')' AS sabor
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
  const { rows: cobros } = await consultar(
    `SELECT p.monto, p.fecha_hora, m.nombre AS medio, ${NOMBRE_USUARIO('p.id_usuario')} AS quien
       FROM pagos_venta p JOIN medios_pago m ON m.id_medio_pago = p.id_medio_pago
      WHERE p.id_venta = $1 ORDER BY p.fecha_hora`,
    [id]
  );
  const cobrado = cobros.reduce((s, c) => s + aCentavos(c.monto), 0) / 100;
  return { venta, renglones, cobros, cobrado, saldo: (aCentavos(venta.total) - aCentavos(cobrado)) / 100 };
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
module.exports.LINEAS = LINEAS;
module.exports.ENVASES = ENVASES;
module.exports.preciosVigentes = preciosVigentes;
