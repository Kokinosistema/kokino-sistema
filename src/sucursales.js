'use strict';

const { consultar } = require('./db');

// Sobre que sucursales puede operar cada usuario. Lo usan la caja y las
// ventas, y tiene que dar lo mismo en las dos: si una pantalla dejara operar
// sobre una sucursal y la otra no, el empleado podria vender en una caja que
// no puede cerrar.
//
// El empleado opera la suya y nada mas. El dueno no tiene sucursal asignada,
// porque ve las dos, asi que a el hay que preguntarle sobre cual va a
// trabajar. Cuando exista la configuracion por computadora que hablamos, ese
// selector desaparece y sale de ahi.
async function sucursalesDisponibles(usuario) {
  if (usuario.id_sucursal_asignada) {
    const { rows } = await consultar(
      'SELECT id_sucursal, nombre, tiene_fabrica FROM sucursales WHERE id_sucursal = $1',
      [usuario.id_sucursal_asignada]
    );
    return rows;
  }
  const { rows } = await consultar(
    'SELECT id_sucursal, nombre, tiene_fabrica FROM sucursales WHERE activa ORDER BY nombre'
  );
  return rows;
}

// La sucursal sobre la que se esta trabajando, para todas las pantallas a la
// vez: las dos sucursales funcionan por separado (caja, ventas y stock
// propios), asi que el dueno elige una arriba y todo el sistema le muestra
// esa hasta que la cambie. El empleado no elige: es la suya.
//
// Queda en req.sucursal y, para las vistas, en res.locals.sucursal. Las
// sucursales entre las que se puede elegir van en res.locals.sucursalesElegibles
// (vacio si no hay eleccion, como en el caso del empleado).
async function sucursalDeTrabajo(req, res, siguiente) {
  try {
    const disponibles = await sucursalesDisponibles(req.session.usuario);
    const guardada = Number(req.session.idSucursalDeTrabajo);
    const actual = disponibles.find((s) => s.id_sucursal === guardada) || disponibles[0];
    if (actual && actual.id_sucursal !== guardada) req.session.idSucursalDeTrabajo = actual.id_sucursal;

    req.sucursal = actual;
    res.locals.sucursal = actual;
    res.locals.sucursalesElegibles = disponibles.length > 1 ? disponibles : [];
    siguiente();
  } catch (error) {
    siguiente(error);
  }
}

// Cambia la sucursal de trabajo y vuelve a la pantalla donde se estaba.
// La direccion de vuelta se acepta solo si es una ruta de este mismo sitio:
// si no, un enlace armado a mano podria mandar al usuario a otra pagina.
// Tiene que empezar con una barra y no seguir con otra barra ni con una
// invertida: los navegadores leen "//otro.com" y "/\otro.com" como otro sitio.
async function cambiarSucursal(req, res, siguiente) {
  try {
    const disponibles = await sucursalesDisponibles(req.session.usuario);
    const pedida = disponibles.find((s) => s.id_sucursal === Number(req.body.id_sucursal));
    if (pedida) {
      req.session.idSucursalDeTrabajo = pedida.id_sucursal;
      req.session.aviso = 'Ahora estás trabajando sobre ' + pedida.nombre + '.';
    }
    const volver = typeof req.body.volver === 'string' ? req.body.volver : '/';
    res.redirect(/^\/(?![/\\])/.test(volver) ? volver : '/');
  } catch (error) {
    siguiente(error);
  }
}

// Los formularios llevan la sucursal sobre la que se armaron. Si no coincide
// con la de trabajo es porque se cambio de sucursal en otra pestana mientras
// esta seguia abierta: se frena, para no cerrar la caja de una sucursal con
// el conteo de la otra.
const CAMBIO_DE_SUCURSAL =
  'Cambiaste de sucursal mientras tenías esta pantalla abierta: revisá los datos y volvé a intentar.';

module.exports = { sucursalesDisponibles, sucursalDeTrabajo, cambiarSucursal, CAMBIO_DE_SUCURSAL };
