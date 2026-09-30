'use strict';

const express = require('express');
const { consultar } = require('../db');
const { normalizarCuit } = require('../cuit');
const { normalizarTelefono } = require('../telefono');
const { parsearMonto, MONTO_INVALIDO } = require('../dinero');

const router = express.Router();

const TIPOS = [
  { valor: 'MINORISTA', texto: 'Minorista' },
  { valor: 'MAYORISTA', texto: 'Mayorista' },
];

// Quien atiende el telefono tiene que poder anotar a quien pide un pedido a
// domicilio, asi que esta pantalla no es solo de los duenos. Pero todo lo que
// tenga que ver con un mayorista si lo es: la cuenta corriente es dar credito,
// y eso es una decision del negocio, no una tarea de mostrador.
//
// La regla queda entonces partida en dos, y se aplica en cada ruta:
//   - empleado: puede ver y cargar clientes minoristas.
//   - administrador: ademas, mayoristas, limite de cuenta corriente y plazo.
function esAdministrador(req) {
  return req.session.usuario.rol === 'administrador';
}

function soloAdministrador(req, res) {
  res.status(403).render('error', {
    titulo: 'No tenes permiso',
    mensaje: 'Los clientes mayoristas y la cuenta corriente son de los duenos.',
  });
}

// Los campos de cuenta corriente solo los lee el administrador. Para el
// empleado ni siquiera se miran: asi no puede borrar un limite mandando el
// formulario sin esos campos.
function leerFormulario(cuerpo, puedeTocarCredito, valoresActuales) {
  const datos = {
    nombre_razon_social: (cuerpo.nombre_razon_social || '').trim(),
    tipo_cliente: cuerpo.tipo_cliente || 'MINORISTA',
    cuit: (cuerpo.cuit || '').trim(),
    telefono: (cuerpo.telefono || '').trim() || null,
    direccion: (cuerpo.direccion || '').trim() || null,
    limite_cuenta_corriente: valoresActuales ? valoresActuales.limite_cuenta_corriente : null,
    plazo_pago_dias: valoresActuales ? valoresActuales.plazo_pago_dias : null,
  };
  const errores = [];

  if (datos.nombre_razon_social.length < 2) {
    errores.push('Poneles un nombre: es lo unico que no puede faltar.');
  }
  if (!TIPOS.some((t) => t.valor === datos.tipo_cliente)) {
    errores.push('Ese tipo de cliente no es uno de los posibles.');
  }

  const revisado = normalizarCuit(datos.cuit);
  if (revisado.error) errores.push(revisado.error);
  else datos.cuit = revisado.cuit;

  const telefono = normalizarTelefono(datos.telefono);
  if (telefono.error) errores.push(telefono.error);
  else datos.telefono = telefono.telefono;

  if (puedeTocarCredito) {

    // El limite es plata: se escribe en formato argentino ($300.000,15).
    // Vacio quiere decir que no tiene cuenta corriente.
    const limite = (cuerpo.limite_cuenta_corriente || '').trim();
    datos.limite_cuenta_corriente = limite === '' ? null : parsearMonto(limite, { permitirCero: true });
    if (limite !== '' && datos.limite_cuenta_corriente === null) {
      errores.push('El límite de cuenta corriente: ' + MONTO_INVALIDO + '.');
    }
    // Dias para pagar: un numero entero de dias, de 0 a 999. Vacio es que no
    // tiene plazo.
    const dias = (cuerpo.plazo_pago_dias || '').trim();
    datos.plazo_pago_dias = /^\d{1,3}$/.test(dias) ? Number(dias) : null;
    if (dias !== '' && datos.plazo_pago_dias === null) {
      errores.push('Los días para pagar tienen que ser un número entero, sin letras ni comas (por ejemplo, 30).');
    }
  }

  // La base tiene un constraint que impide que un minorista tenga cuenta
  // corriente. Se chequea igual aca, porque un constraint que salta le llega a
  // la persona como un texto de PostgreSQL que no le dice nada.
  if (
    datos.tipo_cliente === 'MINORISTA' &&
    (datos.limite_cuenta_corriente !== null || datos.plazo_pago_dias !== null)
  ) {
    errores.push(
      'La cuenta corriente es solo para mayoristas. Si este cliente pasa a minorista, primero hay que vaciarle el limite y el plazo.'
    );
  }

  return { datos, errores };
}

router.get('/', async (req, res, siguiente) => {
  try {
    const mostrarInactivos = req.query.inactivos === '1';
    const puedeCredito = esAdministrador(req);

    // El empleado no ve los mayoristas: no son asunto suyo y ademas le
    // mostrarian a quien se le fia y por cuanto.
    const { rows } = await consultar(
      `SELECT id_cliente, nombre_razon_social, tipo_cliente, cuit, telefono,
              direccion, limite_cuenta_corriente, plazo_pago_dias, activo
         FROM clientes
        WHERE ($1 OR activo)
          AND ($2 OR tipo_cliente = 'MINORISTA')
        ORDER BY activo DESC, nombre_razon_social`,
      [mostrarInactivos, puedeCredito]
    );

    res.render('clientes/lista', { clientes: rows, mostrarInactivos, puedeCredito, TIPOS });
  } catch (error) {
    siguiente(error);
  }
});

router.get('/nuevo', (req, res) => {
  res.render('clientes/formulario', {
    cliente: {
      nombre_razon_social: '', tipo_cliente: 'MINORISTA', cuit: '',
      telefono: '', direccion: '', limite_cuenta_corriente: '', plazo_pago_dias: '',
    },
    errores: [],
    esNuevo: true,
    puedeCredito: esAdministrador(req),
    TIPOS,
  });
});

router.post('/', async (req, res, siguiente) => {
  const puedeCredito = esAdministrador(req);
  const { datos, errores } = leerFormulario(req.body, puedeCredito, null);

  if (!puedeCredito && datos.tipo_cliente === 'MAYORISTA') {
    return soloAdministrador(req, res);
  }

  if (errores.length > 0) {
    return res.status(400).render('clientes/formulario', {
      cliente: req.body, errores, esNuevo: true, puedeCredito, TIPOS,
    });
  }

  try {
    await consultar(
      `INSERT INTO clientes
         (nombre_razon_social, tipo_cliente, cuit, telefono, direccion,
          limite_cuenta_corriente, plazo_pago_dias)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [datos.nombre_razon_social, datos.tipo_cliente, datos.cuit, datos.telefono,
        datos.direccion, datos.limite_cuenta_corriente, datos.plazo_pago_dias]
    );
    req.session.aviso = 'Se agrego a ' + datos.nombre_razon_social + '.';
    res.redirect('/clientes');
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).render('clientes/formulario', {
        cliente: req.body,
        errores: ['Ya hay otro cliente cargado con ese CUIT.'],
        esNuevo: true,
        puedeCredito,
        TIPOS,
      });
    }
    siguiente(error);
  }
});

async function traerCliente(id) {
  const { rows } = await consultar('SELECT * FROM clientes WHERE id_cliente = $1', [id]);
  return rows[0];
}

router.get('/:id/editar', async (req, res, siguiente) => {
  try {
    const cliente = await traerCliente(req.params.id);
    if (!cliente) return siguiente();
    if (cliente.tipo_cliente === 'MAYORISTA' && !esAdministrador(req)) {
      return soloAdministrador(req, res);
    }
    res.render('clientes/formulario', {
      cliente, errores: [], esNuevo: false, puedeCredito: esAdministrador(req), TIPOS,
    });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/:id', async (req, res, siguiente) => {
  try {
    const actual = await traerCliente(req.params.id);
    if (!actual) return siguiente();

    const puedeCredito = esAdministrador(req);
    if (!puedeCredito && (actual.tipo_cliente === 'MAYORISTA' || req.body.tipo_cliente === 'MAYORISTA')) {
      return soloAdministrador(req, res);
    }

    // Al empleado se le conservan los valores que ya tenia el cliente, para
    // que guardar el telefono no le borre nada que no ve.
    const { datos, errores } = leerFormulario(req.body, puedeCredito, actual);

    if (errores.length > 0) {
      return res.status(400).render('clientes/formulario', {
        cliente: Object.assign({ id_cliente: req.params.id }, req.body),
        errores, esNuevo: false, puedeCredito, TIPOS,
      });
    }

    await consultar(
      `UPDATE clientes
          SET nombre_razon_social = $1, tipo_cliente = $2, cuit = $3,
              telefono = $4, direccion = $5,
              limite_cuenta_corriente = $6, plazo_pago_dias = $7
        WHERE id_cliente = $8`,
      [datos.nombre_razon_social, datos.tipo_cliente, datos.cuit, datos.telefono,
        datos.direccion, datos.limite_cuenta_corriente, datos.plazo_pago_dias,
        req.params.id]
    );

    req.session.aviso = 'Se guardaron los cambios de ' + datos.nombre_razon_social + '.';
    res.redirect('/clientes');
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).render('clientes/formulario', {
        cliente: Object.assign({ id_cliente: req.params.id }, req.body),
        errores: ['Ya hay otro cliente cargado con ese CUIT.'],
        esNuevo: false,
        puedeCredito: esAdministrador(req),
        TIPOS,
      });
    }
    siguiente(error);
  }
});

// Baja logica, igual que proveedores: un cliente con ventas viejas tiene que
// seguir existiendo para que esas ventas sigan diciendo a quien se le vendio.
router.post('/:id/baja', async (req, res, siguiente) => {
  try {
    const actual = await traerCliente(req.params.id);
    if (!actual) return siguiente();
    if (actual.tipo_cliente === 'MAYORISTA' && !esAdministrador(req)) {
      return soloAdministrador(req, res);
    }

    const activar = req.body.activar === '1';
    await consultar('UPDATE clientes SET activo = $1 WHERE id_cliente = $2', [
      activar,
      req.params.id,
    ]);

    req.session.aviso = activar
      ? actual.nombre_razon_social + ' vuelve a estar disponible.'
      : actual.nombre_razon_social + ' ya no va a aparecer al cargar ventas.';
    res.redirect('/clientes' + (activar ? '' : '?inactivos=1'));
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
