'use strict';

// Crea una cuenta de acceso para un empleado que ya este cargado.
//
// Existe por una razon puntual: el primer usuario no se puede crear desde el
// sistema, porque para entrar al sistema hace falta un usuario. De aca en
// adelante las cuentas las dan de alta los duenos desde la pantalla de
// usuarios; este script queda para el arranque y para el dia que alguien se
// quede afuera.
//
// La contrasena se pide por teclado y no por argumento a proposito: un
// argumento queda guardado en el historial de la terminal, donde lo puede leer
// cualquiera que se siente despues en esa maquina.
//
// Uso: npm run crear-usuario

const readline = require('readline');
const bcrypt = require('bcrypt');
const { consultar, pool } = require('../src/db');

// 12 vueltas: hoy tarda decimas de segundo, que no se nota al entrar, pero
// vuelve carisimo probar contrasenas de a millones si alguien se llevara la
// tabla.
const VUELTAS_BCRYPT = 12;

// Cuando la entrada viene de un teclado se pregunta de a una. Cuando viene
// canalizada (una prueba automatizada, por ejemplo) readline se cierra apenas
// termina la entrada y ya no sirve para seguir preguntando, asi que en ese caso
// se lee todo junto y se van entregando las respuestas en orden.
let rl = null;
let enCola = null;

async function prepararEntrada() {
  if (process.stdin.isTTY) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return;
  }
  const trozos = [];
  for await (const t of process.stdin) trozos.push(t);
  enCola = trozos.join('').split(/\r?\n/);
}

function preguntar(texto) {
  if (enCola) {
    const respuesta = enCola.shift() || '';
    process.stdout.write(texto + respuesta + '\n');
    return Promise.resolve(respuesta);
  }
  return new Promise((resolver) => rl.question(texto, resolver));
}

// Igual que preguntar, pero sin mostrar lo que se escribe.
function preguntarOculto(texto) {
  if (enCola) {
    const respuesta = enCola.shift() || '';
    process.stdout.write(texto + '\n');
    return Promise.resolve(respuesta);
  }
  return new Promise((resolver) => {
    const alEscribir = (char) => {
      if (char === '\r' || char === '\n') return;
      readline.moveCursor(process.stdout, -1, 0);
      readline.clearLine(process.stdout, 1);
    };
    process.stdin.on('data', alEscribir);
    rl.question(texto, (valor) => {
      process.stdin.removeListener('data', alEscribir);
      process.stdout.write('\n');
      resolver(valor);
    });
  });
}

async function main() {
  await prepararEntrada();

  const { rows: empleados } = await consultar(
    `SELECT e.id_empleado,
            e.nombre,
            coalesce(e.apellido, '')      AS apellido,
            coalesce(s.nombre, 'las dos') AS sucursal
       FROM empleados e
       LEFT JOIN sucursales s ON s.id_sucursal = e.id_sucursal_asignada
      WHERE e.activo
        AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id_empleado = e.id_empleado)
      ORDER BY e.id_empleado`
  );

  if (empleados.length === 0) {
    console.log('Todos los empleados activos ya tienen cuenta.');
    return;
  }

  console.log('\nEmpleados sin cuenta:\n');
  for (const e of empleados) {
    const nombre = [e.nombre, e.apellido].filter(Boolean).join(' ');
    console.log('  ' + String(e.id_empleado).padStart(3) + '  ' + nombre.padEnd(22) + e.sucursal);
  }

  const idEmpleado = Number((await preguntar('\nNumero de empleado: ')).trim());
  const empleado = empleados.find((e) => e.id_empleado === idEmpleado);
  if (!empleado) throw new Error('Ese numero no esta en la lista.');

  const { rows: roles } = await consultar('SELECT id_rol, nombre_rol FROM roles ORDER BY id_rol');
  console.log('\nRoles: ' + roles.map((r) => r.id_rol + '=' + r.nombre_rol).join('  '));
  const idRol = Number((await preguntar('Rol: ')).trim());
  if (!roles.some((r) => r.id_rol === idRol)) throw new Error('Ese rol no existe.');

  const username = (await preguntar('Usuario: ')).trim().toLowerCase();
  if (username.length < 3) throw new Error('El usuario necesita al menos 3 caracteres.');

  const contrasena = await preguntarOculto('Contrasena: ');
  if (contrasena.length < 8) throw new Error('La contrasena necesita al menos 8 caracteres.');
  const repetida = await preguntarOculto('Repetir contrasena: ');
  if (contrasena !== repetida) throw new Error('Las dos contrasenas no coinciden.');

  const hash = await bcrypt.hash(contrasena, VUELTAS_BCRYPT);

  await consultar(
    `INSERT INTO usuarios (id_empleado, id_rol, username, password_hash)
     VALUES ($1, $2, $3, $4)`,
    [idEmpleado, idRol, username, hash]
  );

  const nombre = [empleado.nombre, empleado.apellido].filter(Boolean).join(' ');
  console.log('\nListo: ' + nombre + ' entra como "' + username + '".');
}

main()
  .catch((error) => {
    // El error de clave repetida sale con un texto de PostgreSQL que no le
    // dice nada a quien esta creando la cuenta.
    if (error.code === '23505') {
      console.error('\nEse nombre de usuario ya esta tomado.');
    } else {
      console.error('\n' + error.message);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (rl) rl.close();
    await pool.end();
  });
