'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { CAMBIO_DE_SUCURSAL } = require('../sucursales');

const router = express.Router();

// Envios de la fabrica a la otra sucursal, con recepcion (definido con la
// usuaria el 2026-10-03):
//
//   - Se arman en la sucursal con fabrica: tachos llenos por sabor (salen
//     los que vencen primero) y productos de produccion propia.
//   - Se revisan en un ticket imprimible y se envian: quedan en camino.
//   - En el destino se controla contra el ticket y se marca que llego; ahi
//     se mueve el stock (lo hace la base: cerrar_traslado).
//   - Mientras esta en camino, el origen lo puede cancelar.
//
// No lleva exigirRol: arman y reciben los encargados de cada sucursal y los
// duenos. Lo que se restringe es desde donde: se arma en la sucursal con
// fabrica, se recibe en el destino y se cancela en el origen.

const CANTIDAD_MAXIMA = 999;

function borrador(req) {
  const b = req.session.envio;
  return b && b.id_sucursal === req.sucursal.id_sucursal ? b : null;
}

async function destinos(req) {
  const { rows } = await consultar(
    'SELECT id_sucursal, nombre FROM sucursales WHERE activa AND id_sucursal <> $1 ORDER BY nombre',
    [req.sucursal.id_sucursal]
  );
  return rows;
}

// Lo que se puede enviar desde la sucursal: tachos llenos por sabor, y
// productos propios con stock, descontando lo que ya esta en camino.
async function disponible(idSucursal) {
  const { rows: sabores } = await consultar(
    `SELECT s.id_sabor, s.nombre || ' (' || lower(s.linea) || ')' AS nombre, count(*)::int AS llenos,
            min(l.fecha_vencimiento) AS vence
       FROM tachos t
       JOIN lotes l ON l.id_lote = t.id_lote
       JOIN sabores s ON s.id_sabor = l.id_sabor
      WHERE t.id_sucursal = $1 AND t.estado = 'LLENO'
      GROUP BY s.id_sabor, s.nombre, s.linea
      ORDER BY s.nombre, s.linea`,
    [idSucursal]
  );
  const { rows: productos } = await consultar(
    `SELECT p.id_producto, p.nombre, lower(u.abreviatura) AS unidad,
            coalesce((SELECT sum(m.cantidad) FROM movimientos_producto m
                       WHERE m.id_producto = p.id_producto AND m.id_sucursal = $1), 0)
            - coalesce((SELECT sum(tp.cantidad) FROM traslado_productos tp
                         JOIN traslados tr ON tr.id_traslado = tp.id_traslado
                        WHERE tp.id_producto = p.id_producto AND tr.id_sucursal_origen = $1
                          AND tr.estado = 'EN_CAMINO'), 0) AS disponible
       FROM productos p
       JOIN unidades_medida u ON u.id_unidad = p.id_unidad_medida
      WHERE p.tipo_origen = 'PRODUCIDO_DIRECTO' AND p.lleva_stock_propio AND p.activo
      ORDER BY p.nombre`,
    [idSucursal]
  );
  return { sabores, productos: productos.filter((p) => Number(p.disponible) > 0) };
}

async function envios(idSucursal, estados, limite) {
  const { rows } = await consultar(
    `SELECT tr.id_traslado, tr.estado, tr.fecha_envio, tr.fecha_recepcion,
            so.nombre AS origen, sd.nombre AS destino, tr.id_sucursal_origen, tr.id_sucursal_destino,
            (SELECT count(*) FROM traslado_tachos tt WHERE tt.id_traslado = tr.id_traslado)::int AS tachos,
            (SELECT count(*) FROM traslado_tachos tt WHERE tt.id_traslado = tr.id_traslado AND tt.recibido = false)::int
            + (SELECT count(*) FROM traslado_productos tp WHERE tp.id_traslado = tr.id_traslado AND tp.cantidad_recibida < tp.cantidad)::int AS faltantes,
            (SELECT count(*) FROM traslado_productos tp WHERE tp.id_traslado = tr.id_traslado)::int AS productos
       FROM traslados tr
       JOIN sucursales so ON so.id_sucursal = tr.id_sucursal_origen
       JOIN sucursales sd ON sd.id_sucursal = tr.id_sucursal_destino
      WHERE (tr.id_sucursal_origen = $1 OR tr.id_sucursal_destino = $1) AND tr.estado = ANY($2::text[])
      ORDER BY tr.fecha_envio DESC
      LIMIT $3`,
    [idSucursal, estados, limite]
  );
  return rows;
}

async function mostrar(req, res, { errores = [], estado = 200 } = {}) {
  const idSucursal = req.sucursal.id_sucursal;
  const puedeArmar = req.sucursal.tiene_fabrica;
  res.status(estado).render('envios/index', {
    puedeArmar, errores, CANTIDAD_MAXIMA,
    ...(puedeArmar ? await disponible(idSucursal) : { sabores: [], productos: [] }),
    destinos: puedeArmar ? await destinos(req) : [],
    elegido: borrador(req) || { sabores: {}, productos: {}, observaciones: '', id_destino: '' },
    enCamino: await envios(idSucursal, ['EN_CAMINO'], 50),
    ultimos: await envios(idSucursal, ['RECIBIDO', 'CANCELADO'], 10),
  });
}

router.get('/', async (req, res, siguiente) => {
  try {
    await mostrar(req, res);
  } catch (error) {
    siguiente(error);
  }
});

// Lee lo elegido en el formulario y lo controla contra lo disponible.
async function leerEleccion(req) {
  const { sabores, productos } = await disponible(req.sucursal.id_sucursal);
  const elegido = { id_sucursal: req.sucursal.id_sucursal, sabores: {}, productos: {},
    observaciones: (req.body.observaciones || '').trim().slice(0, 500), id_destino: Number(req.body.id_destino) || '' };
  const errores = [];
  for (const s of sabores) {
    const valor = (req.body['sabor_' + s.id_sabor] || '').trim();
    if (valor === '' || valor === '0') continue;
    if (!/^\d{1,3}$/.test(valor)) { errores.push('La cantidad de ' + s.nombre + ' tiene que ser un número entero.'); continue; }
    if (Number(valor) > s.llenos) { errores.push('De ' + s.nombre + ' hay ' + s.llenos + ' tachos llenos: no se pueden enviar ' + valor + '.'); continue; }
    elegido.sabores[s.id_sabor] = Number(valor);
  }
  for (const p of productos) {
    const valor = (req.body['producto_' + p.id_producto] || '').trim();
    if (valor === '' || valor === '0') continue;
    if (!/^\d{1,3}$/.test(valor)) { errores.push('La cantidad de ' + p.nombre + ' tiene que ser un número entero.'); continue; }
    if (Number(valor) > Number(p.disponible)) { errores.push('De ' + p.nombre + ' hay ' + Number(p.disponible) + ' disponibles: no se pueden enviar ' + valor + '.'); continue; }
    elegido.productos[p.id_producto] = Number(valor);
  }
  if (errores.length === 0 && Object.keys(elegido.sabores).length === 0 && Object.keys(elegido.productos).length === 0) {
    errores.push('Elegí al menos un tacho o un producto para enviar.');
  }
  if (!(await destinos(req)).some((d) => d.id_sucursal === elegido.id_destino)) errores.push('Elegí a qué sucursal va el envío.');
  return { elegido, errores };
}

// Revisar: arma el ticket con lo elegido, sin guardar nada todavia. Los
// tachos que se muestran son los que vencen primero; al enviar se vuelven a
// tomar, por si mientras tanto se abrio alguno.
router.post('/revisar', async (req, res, siguiente) => {
  try {
    if (Number(req.body.id_sucursal) !== req.sucursal.id_sucursal) {
      req.session.aviso = CAMBIO_DE_SUCURSAL;
      return res.redirect('/envios');
    }
    if (!req.sucursal.tiene_fabrica) {
      req.session.aviso = 'Los envíos se arman en la sucursal donde está la fábrica.';
      return res.redirect('/envios');
    }
    const { elegido, errores } = await leerEleccion(req);
    req.session.envio = elegido;
    if (errores.length > 0) return mostrar(req, res, { errores, estado: 400 });
    res.redirect('/envios/revisar');
  } catch (error) {
    siguiente(error);
  }
});

async function armarTicket(elegido, idSucursal) {
  const renglones = [];
  for (const [idSabor, cantidad] of Object.entries(elegido.sabores)) {
    const { rows } = await consultar(
      `SELECT t.codigo_barras, l.fecha_vencimiento, s.nombre || ' (' || lower(s.linea) || ')' AS sabor
         FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote JOIN sabores s ON s.id_sabor = l.id_sabor
        WHERE t.id_sucursal = $1 AND t.estado = 'LLENO' AND l.id_sabor = $2
        ORDER BY l.fecha_vencimiento, t.id_tacho
        LIMIT $3`,
      [idSucursal, idSabor, cantidad]
    );
    if (rows.length > 0) renglones.push({ sabor: rows[0].sabor, cantidad: rows.length, tachos: rows });
  }
  const productos = [];
  for (const [idProducto, cantidad] of Object.entries(elegido.productos)) {
    const { rows: [p] } = await consultar(
      'SELECT p.nombre, lower(u.abreviatura) AS unidad FROM productos p JOIN unidades_medida u ON u.id_unidad = p.id_unidad_medida WHERE p.id_producto = $1',
      [idProducto]
    );
    if (p) productos.push({ nombre: p.nombre, unidad: p.unidad, cantidad });
  }
  return { renglones, productos };
}

router.get('/revisar', async (req, res, siguiente) => {
  try {
    const elegido = borrador(req);
    if (!elegido || !req.sucursal.tiene_fabrica) return res.redirect('/envios');
    const { rows: [destino] } = await consultar('SELECT nombre FROM sucursales WHERE id_sucursal = $1', [elegido.id_destino]);
    const ticket = await armarTicket(elegido, req.sucursal.id_sucursal);
    res.render('envios/revisar', { elegido, destino, ...ticket, armo: req.session.usuario.nombre, fecha: new Date() });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/enviar', async (req, res, siguiente) => {
  try {
    const elegido = borrador(req);
    if (!elegido || !req.sucursal.tiene_fabrica) return res.redirect('/envios');
    const resultado = await conTransaccion(async (ejecutar) => {
      const { rows: [envio] } = await ejecutar(
        `INSERT INTO traslados (id_sucursal_origen, id_sucursal_destino, id_usuario, observaciones)
         VALUES ($1, $2, $3, $4) RETURNING id_traslado`,
        [req.sucursal.id_sucursal, elegido.id_destino, req.session.usuario.id_usuario, elegido.observaciones || null]
      );
      for (const [idSabor, cantidad] of Object.entries(elegido.sabores)) {
        // Los que vencen primero, tomados hasta el final de la transaccion
        // para que nadie los abra o los envie a la vez.
        const { rows: tachos } = await ejecutar(
          `SELECT t.id_tacho FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote
            WHERE t.id_sucursal = $1 AND t.estado = 'LLENO' AND l.id_sabor = $2
            ORDER BY l.fecha_vencimiento, t.id_tacho
            LIMIT $3
            FOR UPDATE OF t`,
          [req.sucursal.id_sucursal, idSabor, cantidad]
        );
        if (tachos.length < cantidad) return { error: 'Mientras revisabas se abrió o se envió algún tacho y ya no alcanzan. Revisá las cantidades.' };
        for (const t of tachos) {
          await ejecutar('INSERT INTO traslado_tachos (id_traslado, id_tacho) VALUES ($1, $2)', [envio.id_traslado, t.id_tacho]);
        }
      }
      for (const [idProducto, cantidad] of Object.entries(elegido.productos)) {
        await ejecutar('INSERT INTO traslado_productos (id_traslado, id_producto, cantidad) VALUES ($1, $2, $3)',
          [envio.id_traslado, idProducto, cantidad]);
      }
      return { id: envio.id_traslado };
    });
    if (resultado.error) {
      req.session.aviso = resultado.error;
      return res.redirect('/envios');
    }
    delete req.session.envio;
    req.session.aviso = 'El envío N° ' + resultado.id + ' quedó en camino. Imprimí el ticket para que viaje con la mercadería.';
    res.redirect('/envios/' + resultado.id);
  } catch (error) {
    siguiente(error);
  }
});

// Un envio, con su ticket. Lo pueden ver el origen y el destino.
async function traerEnvio(req, id) {
  if (!Number.isInteger(id)) return null;
  const { rows: [envio] } = await consultar(
    `SELECT tr.*, so.nombre AS origen, sd.nombre AS destino,
            (SELECT concat_ws(' ', e.nombre, e.apellido) FROM usuarios u JOIN empleados e ON e.id_empleado = u.id_empleado WHERE u.id_usuario = tr.id_usuario) AS armo,
            (SELECT concat_ws(' ', e.nombre, e.apellido) FROM usuarios u JOIN empleados e ON e.id_empleado = u.id_empleado WHERE u.id_usuario = tr.id_usuario_recepcion) AS recibio,
            (SELECT concat_ws(' ', e.nombre, e.apellido) FROM usuarios u JOIN empleados e ON e.id_empleado = u.id_empleado WHERE u.id_usuario = tr.id_usuario_cancelacion) AS cancelo
       FROM traslados tr
       JOIN sucursales so ON so.id_sucursal = tr.id_sucursal_origen
       JOIN sucursales sd ON sd.id_sucursal = tr.id_sucursal_destino
      WHERE tr.id_traslado = $1`,
    [id]
  );
  if (!envio) return null;
  if (envio.id_sucursal_origen !== req.sucursal.id_sucursal && envio.id_sucursal_destino !== req.sucursal.id_sucursal) return null;
  const { rows: tachos } = await consultar(
    `SELECT tt.id_tacho, tt.recibido, tt.motivo_faltante, t.codigo_barras, l.fecha_vencimiento,
            s.nombre || ' (' || lower(s.linea) || ')' AS sabor
       FROM traslado_tachos tt
       JOIN tachos t ON t.id_tacho = tt.id_tacho
       JOIN lotes l ON l.id_lote = t.id_lote
       JOIN sabores s ON s.id_sabor = l.id_sabor
      WHERE tt.id_traslado = $1
      ORDER BY s.nombre, s.linea, l.fecha_vencimiento, t.id_tacho`,
    [id]
  );
  const { rows: productos } = await consultar(
    `SELECT tp.id_producto, tp.cantidad, tp.cantidad_recibida, tp.motivo_faltante, p.nombre, lower(u.abreviatura) AS unidad
       FROM traslado_productos tp
       JOIN productos p ON p.id_producto = tp.id_producto
       JOIN unidades_medida u ON u.id_unidad = p.id_unidad_medida
      WHERE tp.id_traslado = $1
      ORDER BY p.nombre`,
    [id]
  );
  // Agrupados por sabor para el ticket.
  const renglones = [];
  for (const t of tachos) {
    let r = renglones.find((x) => x.sabor === t.sabor);
    if (!r) { r = { sabor: t.sabor, cantidad: 0, tachos: [] }; renglones.push(r); }
    r.cantidad += 1;
    r.tachos.push(t);
  }
  return { envio, tachos, renglones, productos };
}

router.get('/:id', async (req, res, siguiente) => {
  try {
    const datos = await traerEnvio(req, Number(req.params.id));
    if (!datos) return siguiente();
    res.render('envios/ticket', {
      ...datos,
      esDestino: datos.envio.id_sucursal_destino === req.sucursal.id_sucursal,
      esOrigen: datos.envio.id_sucursal_origen === req.sucursal.id_sucursal,
    });
  } catch (error) {
    siguiente(error);
  }
});

// Recibir: en el destino se marca que llego de cada renglon.
async function mostrarRecepcion(res, datos, errores = [], estado = 200) {
  res.status(estado).render('envios/recibir', { ...datos, errores });
}

router.get('/:id/recibir', async (req, res, siguiente) => {
  try {
    const datos = await traerEnvio(req, Number(req.params.id));
    if (!datos) return siguiente();
    if (datos.envio.estado !== 'EN_CAMINO' || datos.envio.id_sucursal_destino !== req.sucursal.id_sucursal) {
      req.session.aviso = 'Ese envío no está para recibir en ' + req.sucursal.nombre + '.';
      return res.redirect('/envios/' + datos.envio.id_traslado);
    }
    await mostrarRecepcion(res, datos);
  } catch (error) {
    siguiente(error);
  }
});

router.post('/:id/recibir', async (req, res, siguiente) => {
  try {
    const datos = await traerEnvio(req, Number(req.params.id));
    if (!datos) return siguiente();
    const { envio, tachos, productos } = datos;
    if (envio.estado !== 'EN_CAMINO' || envio.id_sucursal_destino !== req.sucursal.id_sucursal) {
      req.session.aviso = 'Ese envío no está para recibir en ' + req.sucursal.nombre + '.';
      return res.redirect('/envios/' + envio.id_traslado);
    }

    const errores = [];
    // Lo que se marco, renglon por renglon. Lo que no llego lleva motivo.
    const marcasTachos = tachos.map((t) => {
      const llego = req.body['llego_' + t.id_tacho] === '1';
      const motivo = (req.body['motivo_tacho_' + t.id_tacho] || '').trim().slice(0, 300);
      if (!llego && !motivo) errores.push('El tacho ' + t.codigo_barras + ' de ' + t.sabor + ' no llegó: escribí el motivo.');
      t.recibido = llego; t.motivo_faltante = motivo;
      return { id: t.id_tacho, llego, motivo };
    });
    const marcasProductos = productos.map((p) => {
      const texto = (req.body['recibido_' + p.id_producto] || '').trim();
      const motivo = (req.body['motivo_producto_' + p.id_producto] || '').trim().slice(0, 300);
      const recibida = /^\d{1,3}$/.test(texto) ? Number(texto) : null;
      if (recibida === null || recibida > Number(p.cantidad)) {
        errores.push('De ' + p.nombre + ' se enviaron ' + Number(p.cantidad) + ': poné cuántos llegaron (de 0 a ' + Number(p.cantidad) + ').');
      } else if (recibida < Number(p.cantidad) && !motivo) {
        errores.push('De ' + p.nombre + ' llegaron menos de los enviados: escribí el motivo.');
      }
      p.cantidad_recibida = texto; p.motivo_faltante = motivo;
      return { id: p.id_producto, recibida, motivo };
    });
    if (errores.length > 0) return mostrarRecepcion(res, datos, errores, 400);

    await conTransaccion(async (ejecutar) => {
      for (const m of marcasTachos) {
        await ejecutar('UPDATE traslado_tachos SET recibido = $1, motivo_faltante = $2 WHERE id_traslado = $3 AND id_tacho = $4',
          [m.llego, m.llego ? null : m.motivo, envio.id_traslado, m.id]);
      }
      for (const m of marcasProductos) {
        await ejecutar('UPDATE traslado_productos SET cantidad_recibida = $1, motivo_faltante = $2 WHERE id_traslado = $3 AND id_producto = $4',
          [m.recibida, m.motivo || null, envio.id_traslado, m.id]);
      }
      // Al pasar a RECIBIDO la base mueve el stock (cerrar_traslado).
      await ejecutar(
        "UPDATE traslados SET estado = 'RECIBIDO', fecha_recepcion = now(), id_usuario_recepcion = $1 WHERE id_traslado = $2",
        [req.session.usuario.id_usuario, envio.id_traslado]
      );
    });

    const faltaron = marcasTachos.filter((m) => !m.llego).length;
    req.session.aviso = 'Se recibió el envío N° ' + envio.id_traslado + '. Lo que llegó ya está en el stock de ' + req.sucursal.nombre + '.'
      + (faltaron === 1 ? ' Quedó registrado el tacho que no llegó.' : faltaron > 1 ? ' Quedaron registrados los ' + faltaron + ' tachos que no llegaron.' : '');
    res.redirect('/envios/' + envio.id_traslado);
  } catch (error) {
    siguiente(error);
  }
});

router.post('/:id/cancelar', async (req, res, siguiente) => {
  try {
    const datos = await traerEnvio(req, Number(req.params.id));
    if (!datos) return siguiente();
    const { envio } = datos;
    const motivo = (req.body.motivo || '').trim().slice(0, 300);
    if (envio.estado !== 'EN_CAMINO' || envio.id_sucursal_origen !== req.sucursal.id_sucursal) {
      req.session.aviso = 'Ese envío no se puede cancelar desde ' + req.sucursal.nombre + '.';
    } else if (!motivo) {
      req.session.aviso = 'Para cancelar el envío escribí el motivo.';
    } else {
      await consultar(
        `UPDATE traslados SET estado = 'CANCELADO', fecha_cancelacion = now(), id_usuario_cancelacion = $1, motivo_cancelacion = $2
          WHERE id_traslado = $3`,
        [req.session.usuario.id_usuario, motivo, envio.id_traslado]
      );
      req.session.aviso = 'Se canceló el envío N° ' + envio.id_traslado + '. Sus tachos vuelven a estar disponibles en ' + req.sucursal.nombre + '.';
    }
    res.redirect('/envios/' + envio.id_traslado);
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
