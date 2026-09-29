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
      'SELECT id_sucursal, nombre FROM sucursales WHERE id_sucursal = $1',
      [usuario.id_sucursal_asignada]
    );
    return rows;
  }
  const { rows } = await consultar(
    'SELECT id_sucursal, nombre FROM sucursales WHERE activa ORDER BY nombre'
  );
  return rows;
}

module.exports = { sucursalesDisponibles };
