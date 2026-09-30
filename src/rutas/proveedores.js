'use strict';

const express = require('express');
const { consultar } = require('../db');
const { exigirRol } = require('../middleware/sesion');
const { normalizarCuit } = require('../cuit');
const { normalizarTelefono } = require('../telefono');

const router = express.Router();

// Los valores que la base acepta. Se repiten aca para poder armar los <select>
// y para rechazar cualquier otra cosa antes de llegar a PostgreSQL: el
// constraint es la ultima defensa, no la primera, y un error de constraint le
// llega al usuario como un texto que no entiende.
const PLAZOS = [
  { valor: 'CONTADO', texto: 'Contado, al recibir' },
  { valor: '30_DIAS', texto: 'A 30 dias' },
  { valor: 'FIADO', texto: 'Fiado, cuando pasa a cobrar' },
];
const FORMAS = [
  { valor: 'EFECTIVO', texto: 'Efectivo' },
  { valor: 'DEPOSITO_BANCARIO', texto: 'Deposito bancario' },
  { valor: 'RAPIPAGO', texto: 'Rapipago' },
];

// Administrar proveedores es configuracion del negocio, y eso es de los
// duenos: el rol empleado vende, cobra y carga stock. Darle de alta a un
// proveedor nuevo es una decision, no una tarea de mostrador.
router.use(exigirRol('administrador'));

function leerFormulario(cuerpo) {
  const datos = {
    razon_social: (cuerpo.razon_social || '').trim(),
    cuit: (cuerpo.cuit || '').trim(),
    telefono: (cuerpo.telefono || '').trim() || null,
    plazo_pago: cuerpo.plazo_pago || null,
    forma_pago_habitual: cuerpo.forma_pago_habitual || null,
    datos_cuenta_bancaria: (cuerpo.datos_cuenta_bancaria || '').trim() || null,
    observaciones: (cuerpo.observaciones || '').trim() || null,
  };
  const errores = [];

  if (datos.razon_social.length < 2) {
    errores.push('Poneles un nombre: es lo unico que no puede faltar.');
  }
  const revisado = normalizarCuit(datos.cuit);
  if (revisado.error) errores.push(revisado.error);
  else datos.cuit = revisado.cuit;

  const telefono = normalizarTelefono(datos.telefono);
  if (telefono.error) errores.push(telefono.error);
  else datos.telefono = telefono.telefono;

  if (datos.plazo_pago && !PLAZOS.some((p) => p.valor === datos.plazo_pago)) {
    errores.push('Ese plazo de pago no es uno de los posibles.');
  }
  if (datos.forma_pago_habitual && !FORMAS.some((f) => f.valor === datos.forma_pago_habitual)) {
    errores.push('Esa forma de pago no es una de las posibles.');
  }
  return { datos, errores };
}

// PostgreSQL avisa de los duplicados con un codigo y el nombre del indice. Eso
// es exacto pero ilegible, asi que se traduce al idioma del negocio y se
// devuelve el formulario con lo que la persona ya habia escrito, para que no
// tenga que volver a tipear todo.
function mostrarDuplicado(error, req, res, esNuevo) {
  const mensaje = error.constraint && error.constraint.includes('cuit')
    ? 'Ya hay otro proveedor cargado con ese CUIT.'
    : 'Ya hay otro proveedor con ese nombre.';
  res.status(409).render('proveedores/formulario', {
    proveedor: Object.assign({ id_proveedor: req.params.id }, req.body),
    errores: [mensaje],
    esNuevo,
    PLAZOS,
    FORMAS,
  });
}

// La lista NO trae datos_cuenta_bancaria a proposito. La columna esta marcada
// en la base como dato sensible que no debe verse en pantallas de uso general:
// un CBU solo hace falta cuando se le va a pagar a ese proveedor, no cuando se
// mira la lista. Se muestra si lo tiene cargado, no cual es.
router.get('/', async (req, res, siguiente) => {
  try {
    const mostrarInactivos = req.query.inactivos === '1';
    const { rows } = await consultar(
      `SELECT id_proveedor, razon_social, cuit, telefono,
              plazo_pago, forma_pago_habitual, activo,
              datos_cuenta_bancaria IS NOT NULL AS tiene_cuenta
         FROM proveedores
        WHERE $1 OR activo
        ORDER BY activo DESC, razon_social`,
      [mostrarInactivos]
    );
    res.render('proveedores/lista', { proveedores: rows, mostrarInactivos, PLAZOS, FORMAS });
  } catch (error) {
    siguiente(error);
  }
});

router.get('/nuevo', (req, res) => {
  res.render('proveedores/formulario', {
    proveedor: {
      razon_social: '', cuit: '', telefono: '', plazo_pago: '',
      forma_pago_habitual: '', datos_cuenta_bancaria: '', observaciones: '',
    },
    errores: [],
    esNuevo: true,
    PLAZOS,
    FORMAS,
  });
});

router.post('/', async (req, res, siguiente) => {
  const { datos, errores } = leerFormulario(req.body);
  if (errores.length > 0) {
    return res.status(400).render('proveedores/formulario', {
      proveedor: req.body, errores, esNuevo: true, PLAZOS, FORMAS,
    });
  }
  try {
    await consultar(
      `INSERT INTO proveedores
         (razon_social, cuit, telefono, plazo_pago, forma_pago_habitual,
          datos_cuenta_bancaria, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [datos.razon_social, datos.cuit, datos.telefono, datos.plazo_pago,
        datos.forma_pago_habitual, datos.datos_cuenta_bancaria, datos.observaciones]
    );
    req.session.aviso = 'Se agrego a ' + datos.razon_social + '.';
    res.redirect('/proveedores');
  } catch (error) {
    if (error.code === '23505') return mostrarDuplicado(error, req, res, true);
    siguiente(error);
  }
});

router.get('/:id/editar', async (req, res, siguiente) => {
  try {
    const { rows } = await consultar(
      'SELECT * FROM proveedores WHERE id_proveedor = $1',
      [req.params.id]
    );
    if (rows.length === 0) return siguiente();
    res.render('proveedores/formulario', {
      proveedor: rows[0], errores: [], esNuevo: false, PLAZOS, FORMAS,
    });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/:id', async (req, res, siguiente) => {
  const { datos, errores } = leerFormulario(req.body);
  if (errores.length > 0) {
    return res.status(400).render('proveedores/formulario', {
      proveedor: Object.assign({ id_proveedor: req.params.id }, req.body),
      errores, esNuevo: false, PLAZOS, FORMAS,
    });
  }
  try {
    const { rowCount } = await consultar(
      `UPDATE proveedores
          SET razon_social = $1, cuit = $2, telefono = $3, plazo_pago = $4,
              forma_pago_habitual = $5, datos_cuenta_bancaria = $6, observaciones = $7
        WHERE id_proveedor = $8`,
      [datos.razon_social, datos.cuit, datos.telefono, datos.plazo_pago,
        datos.forma_pago_habitual, datos.datos_cuenta_bancaria, datos.observaciones,
        req.params.id]
    );
    if (rowCount === 0) return siguiente();
    req.session.aviso = 'Se guardaron los cambios de ' + datos.razon_social + '.';
    res.redirect('/proveedores');
  } catch (error) {
    if (error.code === '23505') return mostrarDuplicado(error, req, res, false);
    siguiente(error);
  }
});

// Baja logica, no borrado. Un proveedor al que se le compro durante anos tiene
// que seguir existiendo para que las compras viejas sigan diciendo a quien se
// le compro; lo que se apaga es que aparezca al cargar una compra nueva.
router.post('/:id/baja', async (req, res, siguiente) => {
  try {
    const activar = req.body.activar === '1';
    const { rows } = await consultar(
      'UPDATE proveedores SET activo = $1 WHERE id_proveedor = $2 RETURNING razon_social',
      [activar, req.params.id]
    );
    if (rows.length === 0) return siguiente();
    req.session.aviso = activar
      ? rows[0].razon_social + ' vuelve a estar disponible.'
      : rows[0].razon_social + ' ya no va a aparecer al cargar compras.';
    res.redirect('/proveedores' + (activar ? '' : '?inactivos=1'));
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
