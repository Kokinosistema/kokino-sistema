'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { exigirRol } = require('../middleware/sesion');
const { parsearMonto, MONTO_INVALIDO, aCentavos } = require('../dinero');

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

module.exports = router;
module.exports.LINEAS = LINEAS;
module.exports.ENVASES = ENVASES;
module.exports.preciosVigentes = preciosVigentes;
