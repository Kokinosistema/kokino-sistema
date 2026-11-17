'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { exigirRol } = require('../middleware/sesion');
const { parsearMonto, MONTO_INVALIDO } = require('../dinero');
const { calcularCotizacion } = require('../cotizador');
const { ENVASES, PAGOS, traerCliente, cuentaDe, mediosDePago } = require('./mayoristas');

const router = express.Router();

// Cotizar a un mayorista, traido del Sistema Rody (2026-10-22). Solo los
// duenos. Se arma la cotizacion con la lista de precios del cliente y se
// manda por WhatsApp sin tocar nada; recien cuando el cliente se la lleva
// se confirma, se guarda la venta y salen los tachos del stock de la
// sucursal de trabajo (los que vencen primero).
router.use(exigirRol('administrador'));

const HELADERIA = 'Heladería Kokino';

// La lista del cliente (la suya, o la general si no tiene) con sus precios
// vigentes, en el formato que usa src/cotizador.js.
async function listaDe(cliente) {
  const { rows: [lista] } = await consultar(
    `SELECT id_lista_precios, nombre, incluye_familiar, incluye_artesanal
       FROM listas_precios_mayoristas
      WHERE id_lista_precios = $1::int OR ($1::int IS NULL AND es_general)`,
    [cliente.id_lista_precios]
  );
  const { rows } = await consultar(
    'SELECT id_sabor, precio FROM precios_lista_mayorista WHERE id_lista_precios = $1 AND fecha_vigencia_hasta IS NULL',
    [lista.id_lista_precios]
  );
  return {
    id: lista.id_lista_precios,
    nombre: lista.nombre,
    incluyeFamiliar: lista.incluye_familiar,
    incluyeArtesanal: lista.incluye_artesanal,
    precios: Object.fromEntries(rows.map((r) => [r.id_sabor, Number(r.precio)])),
  };
}

async function precioDelEnvase() {
  const { rows: [e] } = await consultar('SELECT precio FROM precios_envase_mayorista WHERE fecha_vigencia_hasta IS NULL');
  return e ? Number(e.precio) : null;
}

// Los sabores de las lineas que incluye la lista, tengan precio o no, con los
// tachos llenos de la sucursal: se puede cotizar lo que no hay (para un
// encargo), pero no confirmarlo.
async function saboresDeLaLista(lista, idSucursal) {
  const { rows } = await consultar(
    `SELECT s.id_sabor, s.nombre || ' (' || lower(s.linea) || ')' AS nombre, s.nombre AS sabor, s.linea,
            (SELECT count(*) FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote
              WHERE l.id_sabor = s.id_sabor AND t.estado = 'LLENO' AND t.id_sucursal = $1)::int AS llenos
       FROM sabores s
      WHERE s.activo AND ((s.linea = 'FAMILIAR' AND $2) OR (s.linea = 'ARTESANAL' AND $3))
      ORDER BY s.nombre, s.linea`,
    [idSucursal, lista.incluyeFamiliar, lista.incluyeArtesanal]
  );
  return rows.map((s) => ({ ...s, precio: lista.precios[s.id_sabor] ?? null }));
}

function borradorDe(req, cliente) {
  const b = req.session.cotizacion;
  return b && b.id_cliente === cliente.id_cliente && b.id_sucursal === req.sucursal.id_sucursal ? b : null;
}

const lista = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const texto = (v) => (typeof v === 'string' ? v.trim() : '');

// Controla la cotizacion para confirmarla y la calcula con el cotizador, el
// mismo que usa la pantalla. Lo usan "Se lo lleva", revisar y confirmar: lo
// que se guarda pasa siempre por el mismo control.
async function controlarCotizacion(borrador, cliente, sucursal) {
  const errores = [];
  const listaPrecios = await listaDe(cliente);
  const sabores = await saboresDeLaLista(listaPrecios, sucursal.id_sucursal);
  const precioEnvase = await precioDelEnvase();

  const renglones = [];
  for (const r of borrador.renglones) {
    const sabor = sabores.find((s) => s.id_sabor === Number(r.id_sabor));
    if (!sabor) { errores.push('Un sabor de la cotización no se cotiza con la ' + listaPrecios.nombre + ': sacalo.'); continue; }
    if (!/^\d{1,3}$/.test(r.tachos) || Number(r.tachos) < 1) { errores.push('Los tachos de ' + sabor.nombre + ' tienen que ser un número entero.'); continue; }
    let precio = null;
    if (r.precio !== '') {
      precio = parsearMonto(r.precio);
      if (precio === null) { errores.push('El precio de ' + sabor.nombre + ': ' + MONTO_INVALIDO + '.'); continue; }
    }
    // Si el mismo sabor vino dos veces, se suman los tachos.
    const igual = renglones.find((x) => x.idSabor === sabor.id_sabor);
    if (igual) { igual.tachos += Number(r.tachos); continue; }
    renglones.push({ idSabor: sabor.id_sabor, sabor: sabor.sabor, nombre: sabor.nombre, linea: sabor.linea, tachos: Number(r.tachos), precio, llenos: sabor.llenos });
  }
  if (borrador.renglones.length === 0) errores.push('Agregá al menos un sabor.');

  const compraEnvases = borrador.compra_envases === 'SI' ? true : borrador.compra_envases === 'NO' ? false : null;
  const cotizacion = calcularCotizacion({
    lista: listaPrecios, precioEnvase: precioEnvase ?? 0, renglones, compraEnvases,
    envasesComprados: Number(borrador.envases_comprados) || 0,
  });

  for (const r of cotizacion.renglones) {
    if (r.estado === 'sin-precio') errores.push(r.nombre + ' no tiene precio en la ' + listaPrecios.nombre + ': sacalo, o cargale el precio en la lista.');
    if (r.tachos > r.llenos) {
      errores.push('De ' + r.nombre + ' hay ' + r.llenos + (r.llenos === 1 ? ' tacho lleno' : ' tachos llenos') + ' en ' + sucursal.nombre + ': no alcanzan para ' + r.tachos + '.');
    }
  }
  if (compraEnvases === null) errores.push('Respondé si compra los envases.');
  if (compraEnvases) {
    const pedidos = borrador.envases_comprados;
    if (!/^\d{1,3}$/.test(pedidos) || Number(pedidos) < 1 || Number(pedidos) > cotizacion.tachos) {
      errores.push('Poné cuántos envases compra: entre 1 y ' + cotizacion.tachos + ', uno por tacho.');
    }
    if (precioEnvase === null) errores.push('No hay precio del envase cargado.');
  }
  return { listaPrecios, sabores, precioEnvase, cotizacion, errores };
}

// Cada tacho que sale es de envase comprado o prestado. Los comprados se
// asignan a los primeros tachos, en el orden de la cotizacion: da igual
// cuales son, pero revisar y confirmar tienen que asignarlos igual.
function repartirEnvases(cotizacion) {
  let comprados = cotizacion.envasesComprados;
  const partes = [];
  for (const r of cotizacion.renglones) {
    const incluidos = Math.min(comprados, r.tachos);
    comprados -= incluidos;
    if (incluidos > 0) partes.push({ renglon: r, envase: 'INCLUIDO', cantidad: incluidos });
    if (r.tachos - incluidos > 0) partes.push({ renglon: r, envase: 'RETORNABLE', cantidad: r.tachos - incluidos });
  }
  return partes;
}

// ---------------------------------------------------------------------------
// Elegir el cliente

router.get('/', async (req, res, siguiente) => {
  try {
    const { rows: clientes } = await consultar(
      `SELECT c.id_cliente, c.nombre_razon_social,
              coalesce(l.nombre, (SELECT nombre FROM listas_precios_mayoristas WHERE es_general)) AS lista
         FROM clientes c
         LEFT JOIN listas_precios_mayoristas l ON l.id_lista_precios = c.id_lista_precios
        WHERE c.tipo_cliente = 'MAYORISTA' AND c.activo
        ORDER BY c.nombre_razon_social`
    );
    res.render('cotizar/elegir', { clientes });
  } catch (error) {
    siguiente(error);
  }
});

// ---------------------------------------------------------------------------
// Armar la cotizacion

function dadoDeBaja(req, res, cliente) {
  req.session.aviso = cliente.nombre_razon_social + ' está dado de baja: reactivalo para cotizarle.';
  res.redirect('/clientes/' + cliente.id_cliente);
}

async function mostrarArmado(req, res, cliente, { borrador, errores = [], estado = 200 }) {
  const listaPrecios = await listaDe(cliente);
  res.status(estado).render('cotizar/armar', {
    cliente, borrador, errores, HELADERIA,
    listaPrecios,
    sabores: await saboresDeLaLista(listaPrecios, req.sucursal.id_sucursal),
    precioEnvase: await precioDelEnvase(),
  });
}

router.get('/:id', async (req, res, siguiente) => {
  try {
    const cliente = await traerCliente(Number(req.params.id));
    if (!cliente) return siguiente();
    if (!cliente.activo) return dadoDeBaja(req, res, cliente);
    const borrador = borradorDe(req, cliente) || { renglones: [], compra_envases: '', envases_comprados: '' };
    await mostrarArmado(req, res, cliente, { borrador });
  } catch (error) {
    siguiente(error);
  }
});

// "Se lo lleva": guarda la cotizacion y, si se puede confirmar, pasa a revisar.
router.post('/:id', async (req, res, siguiente) => {
  try {
    const cliente = await traerCliente(Number(req.params.id));
    if (!cliente) return siguiente();
    if (!cliente.activo) return dadoDeBaja(req, res, cliente);
    if (Number(req.body.id_sucursal) !== req.sucursal.id_sucursal) {
      req.session.aviso = 'Cambiaste de sucursal mientras cotizabas: revisá que los tachos estén en esta.';
      return res.redirect('/cotizar/' + cliente.id_cliente);
    }
    const sabores = lista(req.body.renglon_sabor);
    const tachos = lista(req.body.renglon_tachos);
    const precios = lista(req.body.renglon_precio);
    const borrador = {
      id_cliente: cliente.id_cliente,
      id_sucursal: req.sucursal.id_sucursal,
      renglones: sabores.map((s, i) => ({ id_sabor: String(s), tachos: texto(tachos[i]), precio: texto(precios[i]) })),
      compra_envases: ['SI', 'NO'].includes(req.body.compra_envases) ? req.body.compra_envases : '',
      envases_comprados: texto(req.body.envases_comprados),
    };
    req.session.cotizacion = borrador;
    const { errores } = await controlarCotizacion(borrador, cliente, req.sucursal);
    if (errores.length > 0) return mostrarArmado(req, res, cliente, { borrador, errores, estado: 400 });
    res.redirect('/cotizar/' + cliente.id_cliente + '/revisar');
  } catch (error) {
    siguiente(error);
  }
});

// ---------------------------------------------------------------------------
// Revisar y confirmar

async function mostrarRevision(req, res, cliente, borrador, control, { errores = [], valores = {}, estado = 200 } = {}) {
  // Los tachos que saldrian: los que vencen primero de cada sabor.
  const renglones = [];
  const usados = {};
  for (const p of repartirEnvases(control.cotizacion)) {
    const desde = usados[p.renglon.idSabor] || 0;
    usados[p.renglon.idSabor] = desde + p.cantidad;
    const { rows } = await consultar(
      `SELECT t.codigo_barras FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote
        WHERE t.id_sucursal = $1 AND t.estado = 'LLENO' AND l.id_sabor = $2
        ORDER BY l.fecha_vencimiento, t.id_tacho OFFSET $3 LIMIT $4`,
      [req.sucursal.id_sucursal, p.renglon.idSabor, desde, p.cantidad]
    );
    renglones.push({ sabor: p.renglon.nombre, envase: p.envase, cantidad: p.cantidad, precio: p.renglon.precioUnitario, codigos: rows.map((x) => x.codigo_barras) });
  }
  const cuenta = await cuentaDe(cliente);
  const total = control.cotizacion.total;
  res.status(estado).render('cotizar/revisar', {
    cliente, borrador, cuenta, ENVASES, PAGOS, errores, valores, renglones, total,
    envases: { cantidad: control.cotizacion.envasesComprados, precio: control.precioEnvase, total: control.cotizacion.totalEnvases },
    medios: await mediosDePago(),
    superaLimite: cliente.limite_cuenta_corriente !== null && cuenta.deuda + total > Number(cliente.limite_cuenta_corriente),
    fecha: new Date(), vendio: req.session.usuario.nombre,
  });
}

router.get('/:id/revisar', async (req, res, siguiente) => {
  try {
    const cliente = await traerCliente(Number(req.params.id));
    if (!cliente) return siguiente();
    if (!cliente.activo) return dadoDeBaja(req, res, cliente);
    const borrador = borradorDe(req, cliente);
    if (!borrador) return res.redirect('/cotizar/' + cliente.id_cliente);
    const control = await controlarCotizacion(borrador, cliente, req.sucursal);
    if (control.errores.length > 0) return mostrarArmado(req, res, cliente, { borrador, errores: control.errores, estado: 400 });
    await mostrarRevision(req, res, cliente, borrador, control);
  } catch (error) {
    siguiente(error);
  }
});

router.post('/:id/confirmar', async (req, res, siguiente) => {
  try {
    const cliente = await traerCliente(Number(req.params.id));
    if (!cliente) return siguiente();
    if (!cliente.activo) return dadoDeBaja(req, res, cliente);
    const borrador = borradorDe(req, cliente);
    if (!borrador) return res.redirect('/cotizar/' + cliente.id_cliente);
    const control = await controlarCotizacion(borrador, cliente, req.sucursal);
    if (control.errores.length > 0) return mostrarArmado(req, res, cliente, { borrador, errores: control.errores, estado: 400 });

    const valores = { pago: texto(req.body.pago), id_medio_pago: texto(req.body.id_medio_pago) };
    const errores = [];
    if (!PAGOS.some((p) => p.valor === valores.pago)) errores.push('Elegí si pagó ahora o queda a cuenta.');
    if (valores.pago === 'AHORA' && !(await mediosDePago()).some((m) => m.id_medio_pago === Number(valores.id_medio_pago))) {
      errores.push('Elegí con qué pagó.');
    }
    if (valores.pago === 'CUENTA' && cliente.limite_cuenta_corriente === null) {
      errores.push(cliente.nombre_razon_social + ' no tiene cuenta corriente habilitada. Para venderle a cuenta, cargale un límite en Editar cliente.');
    }
    if (errores.length > 0) return mostrarRevision(req, res, cliente, borrador, control, { errores, valores, estado: 400 });

    const { cotizacion, precioEnvase } = control;
    const resultado = await conTransaccion(async (ejecutar) => {
      const { rows: [venta] } = await ejecutar(
        `INSERT INTO ventas (id_usuario, id_cliente, canal_venta, tipo_venta, id_sucursal)
         VALUES ($1, $2, 'MAYORISTA', 'MAYORISTA', $3) RETURNING id_venta`,
        [req.session.usuario.id_usuario, cliente.id_cliente, req.sucursal.id_sucursal]
      );
      const usados = [];
      for (const p of repartirEnvases(cotizacion)) {
        // Los que vencen primero, tomados hasta el final de la transaccion.
        const { rows: tachos } = await ejecutar(
          `SELECT t.id_tacho FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote
            WHERE t.id_sucursal = $1 AND t.estado = 'LLENO' AND l.id_sabor = $2 AND NOT (t.id_tacho = ANY($3::int[]))
            ORDER BY l.fecha_vencimiento, t.id_tacho
            LIMIT $4
            FOR UPDATE OF t`,
          [req.sucursal.id_sucursal, p.renglon.idSabor, usados, p.cantidad]
        );
        if (tachos.length < p.cantidad) return { error: 'Mientras revisabas se abrió, se envió o se vendió algún tacho de ' + p.renglon.nombre + ' y ya no alcanzan. Revisá las cantidades.' };
        for (const t of tachos) {
          usados.push(t.id_tacho);
          await ejecutar(
            'INSERT INTO venta_tachos (id_venta, id_tacho, envase, precio_aplicado, precio_envase) VALUES ($1, $2, $3, $4, $5)',
            [venta.id_venta, t.id_tacho, p.envase, p.renglon.precioUnitario, p.envase === 'INCLUIDO' ? precioEnvase : 0]
          );
        }
      }
      if (valores.pago === 'AHORA' && cotizacion.total > 0) {
        await ejecutar('INSERT INTO pagos_venta (id_venta, id_medio_pago, id_usuario, monto) VALUES ($1, $2, $3, $4)',
          [venta.id_venta, Number(valores.id_medio_pago), req.session.usuario.id_usuario, cotizacion.total]);
      }
      return { id: venta.id_venta };
    });
    if (resultado.error) {
      req.session.aviso = resultado.error;
      return res.redirect('/cotizar/' + cliente.id_cliente);
    }
    delete req.session.cotizacion;
    req.session.aviso = 'Se registró la venta N° ' + resultado.id + ' a ' + cliente.nombre_razon_social + '. Imprimí el remito para que viaje con los tachos.';
    res.redirect('/clientes/ventas/' + resultado.id);
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
