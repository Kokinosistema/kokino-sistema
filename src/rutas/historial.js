'use strict';

// Historial de ventas (pedido de la usuaria el 2026-10-15): buscar una venta
// de otro dia, por un reclamo o para revisar una anulacion, y ver cuanto se
// vendio en un periodo. Solo los duenos: es informacion del negocio entero,
// de las dos sucursales.
//
// Las fechas se toman en hora de Tucuman (la conexion a la base trabaja en
// esa zona, ver src/db.js): una venta de las 23:30 cae en su dia.

const express = require('express');
const { consultar } = require('../db');
const { exigirRol } = require('../middleware/sesion');
const { CANALES } = require('../cartas');

const router = express.Router();
router.use(exigirRol('administrador'));

const POR_PAGINA = 50;

// En el historial tambien estan las ventas mayoristas.
const CANALES_HISTORIAL = CANALES.concat({ valor: 'MAYORISTA', texto: 'Mayorista' });

const ESTADOS = [
  { valor: '', texto: 'Todas' },
  { valor: 'validas', texto: 'Sin las anuladas' },
  { valor: 'anuladas', texto: 'Solo las anuladas' },
];

// Hoy en Tucuman, como AAAA-MM-DD (process.env.TZ lo fija server.js).
function hoy() {
  return new Date().toLocaleDateString('en-CA');
}

const esFecha = (texto) => typeof texto === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(texto)
  && !Number.isNaN(Date.parse(texto + 'T00:00:00'));

// Los filtros vienen en la direccion (?desde=...&canal=...), asi una busqueda
// se puede guardar o mandar. Lo que no se entiende se ignora y queda el valor
// por defecto, en vez de fallar.
function leerFiltros(consulta, sucursales, medios) {
  const f = {
    desde: esFecha(consulta.desde) ? consulta.desde : hoy(),
    hasta: esFecha(consulta.hasta) ? consulta.hasta : hoy(),
    sucursal: sucursales.some((s) => String(s.id_sucursal) === consulta.sucursal) ? consulta.sucursal : '',
    canal: CANALES_HISTORIAL.some((c) => c.valor === consulta.canal) ? consulta.canal : '',
    medio: medios.some((m) => String(m.id_medio_pago) === consulta.medio) ? consulta.medio : '',
    estado: ESTADOS.some((e) => e.valor === consulta.estado) ? consulta.estado : '',
    pagina: Math.max(1, Number.parseInt(consulta.pagina, 10) || 1),
  };
  // Al reves no encuentra nada: se dan vuelta.
  if (f.desde > f.hasta) [f.desde, f.hasta] = [f.hasta, f.desde];
  return f;
}

// El WHERE de la busqueda, con sus parametros. Lo comparten la lista y los
// totales, asi nunca cuentan cosas distintas.
function condiciones(f) {
  const donde = ['vt.fecha_hora >= $1::date', "vt.fecha_hora < $2::date + 1"];
  const parametros = [f.desde, f.hasta];
  const agregar = (sql, valor) => { parametros.push(valor); donde.push(sql.replace('?', '$' + parametros.length)); };
  if (f.sucursal) agregar('v.id_sucursal = ?', Number(f.sucursal));
  if (f.canal) agregar('vt.canal_venta = ?', f.canal);
  if (f.medio) agregar('EXISTS (SELECT 1 FROM pagos_venta p WHERE p.id_venta = v.id_venta AND p.id_medio_pago = ?)', Number(f.medio));
  if (f.estado === 'validas') donde.push('NOT vt.anulada');
  if (f.estado === 'anuladas') donde.push('vt.anulada');
  return { sql: donde.join(' AND '), parametros };
}

// La direccion de la misma busqueda en otra pagina.
function direccion(f, pagina) {
  const p = new URLSearchParams();
  for (const clave of ['desde', 'hasta', 'sucursal', 'canal', 'medio', 'estado']) if (f[clave]) p.set(clave, f[clave]);
  if (pagina > 1) p.set('pagina', pagina);
  return '/historial?' + p.toString();
}

const NOMBRE_USUARIO = (columna) => `(SELECT concat_ws(' ', e.nombre, e.apellido)
   FROM usuarios u JOIN empleados e ON e.id_empleado = u.id_empleado WHERE u.id_usuario = ${columna})`;

router.get('/', async (req, res, siguiente) => {
  try {
    const { rows: sucursales } = await consultar('SELECT id_sucursal, nombre FROM sucursales WHERE activa ORDER BY nombre');
    const { rows: medios } = await consultar('SELECT id_medio_pago, nombre FROM medios_pago ORDER BY id_medio_pago');
    const f = leerFiltros(req.query, sucursales, medios);
    const { sql, parametros } = condiciones(f);

    const { rows: [totales] } = await consultar(
      `SELECT count(*) FILTER (WHERE NOT vt.anulada)::int AS ventas,
              coalesce(sum(vt.total) FILTER (WHERE NOT vt.anulada), 0) AS monto,
              count(*) FILTER (WHERE vt.anulada)::int AS anuladas,
              coalesce(sum(vt.total) FILTER (WHERE vt.anulada), 0) AS monto_anuladas
         FROM ventas_totales vt JOIN ventas v ON v.id_venta = vt.id_venta
        WHERE ${sql}`,
      parametros
    );
    const encontradas = totales.ventas + totales.anuladas;
    const paginas = Math.max(1, Math.ceil(encontradas / POR_PAGINA));
    if (f.pagina > paginas) f.pagina = paginas;

    const { rows: ventas } = await consultar(
      `SELECT vt.id_venta, vt.fecha_hora, vt.canal_venta, vt.tipo_venta, vt.total, vt.anulada,
              s.nombre AS sucursal, v.motivo_anulacion,
              ${NOMBRE_USUARIO('v.id_usuario')} AS vendio,
              ${NOMBRE_USUARIO('v.id_usuario_anulacion')} AS anulo,
              (SELECT c.nombre_razon_social FROM clientes c WHERE c.id_cliente = v.id_cliente) AS cliente,
              (SELECT string_agg(trim_scale(d.cantidad) || '× ' || p.nombre, ', ' ORDER BY d.id_venta_detalle)
                 FROM venta_detalle d JOIN productos p ON p.id_producto = d.id_producto
                WHERE d.id_venta = v.id_venta) AS productos,
              (SELECT count(*) FROM venta_tachos t WHERE t.id_venta = v.id_venta)::int AS tachos,
              (SELECT string_agg(DISTINCT m.nombre, ', ')
                 FROM pagos_venta p JOIN medios_pago m ON m.id_medio_pago = p.id_medio_pago
                WHERE p.id_venta = v.id_venta) AS medios
         FROM ventas_totales vt
         JOIN ventas v ON v.id_venta = vt.id_venta
         JOIN sucursales s ON s.id_sucursal = v.id_sucursal
        WHERE ${sql}
        ORDER BY vt.fecha_hora DESC, vt.id_venta DESC
        LIMIT ${POR_PAGINA} OFFSET ${(f.pagina - 1) * POR_PAGINA}`,
      parametros
    );

    res.render('historial/lista', {
      f, ventas, totales, encontradas, paginas, sucursales, medios,
      CANALES: CANALES_HISTORIAL, ESTADOS,
      anterior: f.pagina > 1 ? direccion(f, f.pagina - 1) : null,
      siguiente: f.pagina < paginas ? direccion(f, f.pagina + 1) : null,
      volver: direccion(f, f.pagina),
    });
  } catch (error) {
    siguiente(error);
  }
});

router.get('/:id', async (req, res, siguiente) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return siguiente();
    const { rows: [venta] } = await consultar(
      `SELECT vt.id_venta, vt.fecha_hora, vt.canal_venta, vt.tipo_venta, vt.total, vt.anulada,
              v.id_caja, v.fecha_anulacion, v.motivo_anulacion, s.nombre AS sucursal,
              c.fecha_cierre AS caja_cerrada,
              ${NOMBRE_USUARIO('v.id_usuario')} AS vendio,
              ${NOMBRE_USUARIO('v.id_usuario_anulacion')} AS anulo
         FROM ventas_totales vt
         JOIN ventas v ON v.id_venta = vt.id_venta
         JOIN sucursales s ON s.id_sucursal = v.id_sucursal
         LEFT JOIN cajas c ON c.id_caja = v.id_caja
        WHERE vt.id_venta = $1`,
      [id]
    );
    if (!venta) return siguiente();
    // La venta mayorista ya tiene su pantalla, con los tachos y el remito.
    if (venta.tipo_venta === 'MAYORISTA') return res.redirect('/clientes/ventas/' + id);

    const { rows: lineas } = await consultar(
      `SELECT p.nombre, trim_scale(d.cantidad) AS cantidad, d.precio_unitario_aplicado AS precio,
              d.cantidad * d.precio_unitario_aplicado AS subtotal
         FROM venta_detalle d JOIN productos p ON p.id_producto = d.id_producto
        WHERE d.id_venta = $1
        ORDER BY d.id_venta_detalle`,
      [id]
    );
    const { rows: pagos } = await consultar(
      `SELECT m.nombre AS medio, p.monto
         FROM pagos_venta p JOIN medios_pago m ON m.id_medio_pago = p.id_medio_pago
        WHERE p.id_venta = $1
        ORDER BY p.id_pago_venta`,
      [id]
    );
    const volver = typeof req.query.volver === 'string' && req.query.volver.startsWith('/historial?')
      ? req.query.volver : '/historial';
    res.render('historial/venta', {
      venta, lineas, pagos, volver,
      canal: (CANALES_HISTORIAL.find((c) => c.valor === venta.canal_venta) || {}).texto,
    });
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
