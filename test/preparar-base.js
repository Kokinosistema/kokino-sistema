'use strict';

// Arma la base de prueba desde cero antes de cada corrida de `npm test`:
// la borra, la crea vacia, corre todas las migraciones y los seeds, y carga
// los usuarios de prueba. Asi cada corrida arranca del mismo punto y un
// resultado no depende de lo que dejo la anterior. De paso prueba que la
// base se pueda reconstruir entera, como dice el README.

const { spawnSync } = require('child_process');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { urlDePrueba, exigirBaseDePrueba, USUARIOS } = require('./base-de-prueba');

const RAIZ = path.join(__dirname, '..');

function correr(nombre, argumentos, url) {
  const resultado = spawnSync(process.execPath, argumentos, {
    cwd: RAIZ,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  if (resultado.status !== 0) {
    throw new Error(nombre + ' fallo:\n' + (resultado.stderr || resultado.stdout));
  }
}

async function conectado(url, tarea) {
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    return await tarea(cliente);
  } finally {
    await cliente.end();
  }
}

(async () => {
  const url = urlDePrueba();
  const nombre = exigirBaseDePrueba(url);

  // Para borrar y crear una base hay que estar conectado a otra.
  const servidor = new URL(url);
  servidor.pathname = '/postgres';
  await conectado(servidor.toString(), async (cliente) => {
    // FORCE corta las conexiones que hubiera (por ejemplo, un servidor de
    // prueba que quedo andando), que si no impedirian borrarla.
    await cliente.query('DROP DATABASE IF EXISTS "' + nombre + '" WITH (FORCE)');
    await cliente.query('CREATE DATABASE "' + nombre + '"');
  });

  const migrar = path.join(path.dirname(require.resolve('node-pg-migrate/package.json')), 'bin', 'node-pg-migrate.js');
  correr('Las migraciones', [migrar, 'up'], url);
  for (const seed of ['precios', 'costos', 'costos_insumo']) {
    correr('El seed ' + seed, [path.join('seeds', seed + '.js')], url);
  }

  // Cost 4 y no 12 como en crear-usuario: son claves de prueba, y asi entrar
  // no demora cada prueba.
  await conectado(url, async (cliente) => {
    for (const u of Object.values(USUARIOS)) {
      const { rows } = await cliente.query(
        `INSERT INTO usuarios (id_empleado, id_rol, username, password_hash)
         SELECT e.id_empleado, r.id_rol, $1, $2
           FROM empleados e, roles r
          WHERE e.nombre = $3 AND e.apellido IS NOT DISTINCT FROM $4 AND r.nombre_rol = $5
         RETURNING id_usuario`,
        [u.username, await bcrypt.hash(u.contrasena, 4), u.empleado[0], u.empleado[1], u.rol]
      );
      if (rows.length !== 1) throw new Error('No se pudo crear el usuario de prueba ' + u.username);
    }
  });

  console.log('Base de prueba ' + nombre + ' lista.');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
