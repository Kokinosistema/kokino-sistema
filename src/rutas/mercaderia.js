'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { CAMBIO_DE_SUCURSAL } = require('../sucursales');

const router = express.Router();

// Mercaderia que llega de los proveedores (2026-10-05): la registra quien la
// recibe, empleado o dueno, en la sucursal de trabajo. Solo cantidades, sin
// precios: las compras se piden por WhatsApp y no pasan por el sistema. El
// proveedor y el numero de remito son opcionales.
//
// Lo que llega son los productos que se revenden (alfajores, reposteria
// comprada) y los insumos (cucuruchos, termicos, cafe, materia prima).

const lista = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// Lo que puede llegar, con su unidad. Lo que se cuenta (unidades, paquetes,
// botellas) va en numeros enteros; lo que se pesa o se mide, con hasta tres
// decimales.
async function opciones() {
  const { rows } = await consultar(
    `SELECT 'producto:' || p.id_producto AS valor, p.nombre, 'Productos — ' || c.nombre AS grupo,
            lower(u.abreviatura) AS unidad, u.magnitud = 'CONTEO' AS entero
       FROM productos p
       JOIN categorias c ON c.id_categoria = p.id_categoria
       JOIN unidades_medida u ON u.id_unidad = p.id_unidad_medida
      WHERE p.activo AND p.tipo_origen = 'COMPRADO_TERMINADO' AND p.lleva_stock_propio
     UNION ALL
     SELECT 'insumo:' || i.id_insumo, i.nombre, 'Insumos — ' || c.nombre,
            lower(u.abreviatura), u.magnitud = 'CONTEO'
       FROM insumos i
       JOIN categorias c ON c.id_categoria = i.id_categoria
       JOIN unidades_medida u ON u.id_unidad = i.id_unidad_medida
      WHERE i.activo
      ORDER BY grupo, nombre`
  );
  return rows;
}

async function proveedores() {
  const { rows } = await consultar('SELECT id_proveedor, razon_social FROM proveedores WHERE activo ORDER BY razon_social');
  return rows;
}

async function ultimosIngresos(idSucursal) {
  const { rows } = await consultar(
    `SELECT i.id_ingreso, i.fecha_hora, i.numero_remito, i.observaciones, pv.razon_social AS proveedor,
            (SELECT concat_ws(' ', e.nombre, e.apellido) FROM usuarios u JOIN empleados e ON e.id_empleado = u.id_empleado
              WHERE u.id_usuario = i.id_usuario) AS quien,
            (SELECT string_agg(x.texto, ' · ' ORDER BY x.texto) FROM (
               SELECT p.nombre || ': ' || replace(trim(trailing '.' FROM trim(trailing '0' FROM m.cantidad::text)), '.', ',') || ' ' || lower(u.abreviatura) AS texto
                 FROM movimientos_producto m JOIN productos p ON p.id_producto = m.id_producto
                 JOIN unidades_medida u ON u.id_unidad = p.id_unidad_medida WHERE m.id_ingreso = i.id_ingreso
               UNION ALL
               SELECT ins.nombre || ': ' || replace(trim(trailing '.' FROM trim(trailing '0' FROM m.cantidad::text)), '.', ',') || ' ' || lower(u.abreviatura)
                 FROM movimientos_insumo m JOIN insumos ins ON ins.id_insumo = m.id_insumo
                 JOIN unidades_medida u ON u.id_unidad = ins.id_unidad_medida WHERE m.id_ingreso = i.id_ingreso
             ) x) AS detalle
       FROM ingresos_mercaderia i
       LEFT JOIN proveedores pv ON pv.id_proveedor = i.id_proveedor
      WHERE i.id_sucursal = $1
      ORDER BY i.fecha_hora DESC
      LIMIT 15`,
    [idSucursal]
  );
  return rows;
}

async function mostrar(req, res, { elegido = null, errores = [], estado = 200 } = {}) {
  res.status(estado).render('mercaderia/index', {
    opciones: await opciones(),
    proveedores: await proveedores(),
    ultimos: await ultimosIngresos(req.sucursal.id_sucursal),
    elegido: elegido || { renglones: [], id_proveedor: '', numero_remito: '', observaciones: '' },
    errores,
  });
}

router.get('/', async (req, res, siguiente) => {
  try {
    await mostrar(req, res);
  } catch (error) {
    siguiente(error);
  }
});

router.post('/', async (req, res, siguiente) => {
  try {
    if (Number(req.body.id_sucursal) !== req.sucursal.id_sucursal) {
      req.session.aviso = CAMBIO_DE_SUCURSAL;
      return res.redirect('/mercaderia');
    }
    const todas = await opciones();
    const provs = await proveedores();
    const elegido = {
      renglones: lista(req.body.renglon_item).map((v, i) => ({ valor: String(v), cantidad: String(lista(req.body.renglon_cantidad)[i] || '').trim() })),
      id_proveedor: typeof req.body.id_proveedor === 'string' ? req.body.id_proveedor : '',
      numero_remito: (typeof req.body.numero_remito === 'string' ? req.body.numero_remito : '').trim().slice(0, 50),
      observaciones: (typeof req.body.observaciones === 'string' ? req.body.observaciones : '').trim().slice(0, 500),
    };
    const errores = [];
    const renglones = [];
    const vistos = new Set();
    for (const r of elegido.renglones) {
      const o = todas.find((x) => x.valor === r.valor);
      if (!o) { errores.push('Algo de la lista ya no está disponible: sacalo y volvé a agregarlo.'); continue; }
      if (vistos.has(o.valor)) { errores.push('"' + o.nombre + '" está dos veces en la lista: dejalo una sola vez con el total.'); continue; }
      vistos.add(o.valor);
      const patron = o.entero ? /^\d{1,6}$/ : /^\d{1,6}(,\d{1,3})?$/;
      const cantidad = patron.test(r.cantidad) ? Number(r.cantidad.replace(',', '.')) : 0;
      if (cantidad <= 0) {
        errores.push('La cantidad de "' + o.nombre + '" ' + (o.entero ? 'es un número entero (' + o.unidad + ').' : 'va en ' + o.unidad + ', con coma para los decimales (por ejemplo: 2,5).'));
        continue;
      }
      const [tipo, id] = o.valor.split(':');
      renglones.push({ tipo, id: Number(id), cantidad });
    }
    if (elegido.renglones.length === 0) errores.push('Agregá lo que llegó.');
    if (elegido.id_proveedor !== '' && !provs.some((p) => String(p.id_proveedor) === elegido.id_proveedor)) errores.push('Elegí un proveedor de la lista o dejalo sin elegir.');
    if (errores.length > 0) return mostrar(req, res, { elegido, errores, estado: 400 });

    await conTransaccion(async (ejecutar) => {
      const { rows: [ingreso] } = await ejecutar(
        `INSERT INTO ingresos_mercaderia (id_sucursal, id_proveedor, numero_remito, observaciones, id_usuario)
         VALUES ($1, $2, $3, $4, $5) RETURNING id_ingreso`,
        [req.sucursal.id_sucursal, elegido.id_proveedor ? Number(elegido.id_proveedor) : null,
          elegido.numero_remito || null, elegido.observaciones || null, req.session.usuario.id_usuario]
      );
      for (const r of renglones) {
        const tabla = r.tipo === 'producto' ? 'movimientos_producto' : 'movimientos_insumo';
        const columna = r.tipo === 'producto' ? 'id_producto' : 'id_insumo';
        await ejecutar(
          `INSERT INTO ${tabla} (${columna}, id_sucursal, tipo_movimiento, cantidad, id_usuario, id_ingreso)
           VALUES ($1, $2, 'ENTRADA_COMPRA', $3, $4, $5)`,
          [r.id, req.sucursal.id_sucursal, r.cantidad, req.session.usuario.id_usuario, ingreso.id_ingreso]
        );
      }
    });
    req.session.aviso = 'Se registró lo que llegó (' + renglones.length + (renglones.length === 1 ? ' cosa' : ' cosas') + '). Ya suma al stock de ' + req.sucursal.nombre + '.';
    res.redirect('/mercaderia');
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
