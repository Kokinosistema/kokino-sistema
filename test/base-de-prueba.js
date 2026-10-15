'use strict';

// Que base usan las pruebas. Sale de DATABASE_URL_PRUEBA si esta, y si no, de
// DATABASE_URL con el nombre de la base cambiado por kokino_prueba: asi no
// hace falta agregar nada al .env para correr las pruebas.
//
// Las pruebas BORRAN esa base y la arman de nuevo en cada corrida. Por eso
// exigirBaseDePrueba se niega a seguir si el nombre no termina en _prueba:
// un error en el .env no puede terminar borrando kokino_dev ni la base de la
// heladeria.

function urlDePrueba() {
  if (process.env.DATABASE_URL_PRUEBA) return process.env.DATABASE_URL_PRUEBA;
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en el .env (ver .env.example).');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/kokino_prueba';
  return url.toString();
}

function nombreDeLaBase(url) {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

function exigirBaseDePrueba(url) {
  const nombre = nombreDeLaBase(url);
  if (!/_prueba$/.test(nombre)) {
    throw new Error('Las pruebas borran su base y "' + nombre + '" no termina en _prueba. '
      + 'No se corre nada, para no borrar una base de verdad.');
  }
  return nombre;
}

// Los usuarios con los que entran las pruebas. Son de empleados que ya
// carga una migracion, y solo existen en la base de prueba.
const USUARIOS = {
  empleado: { username: 'empleado.prueba', contrasena: 'clave-de-prueba-1', empleado: ['Nicolás', 'Escudero'], rol: 'empleado' },
  empleadoAlem: { username: 'alem.prueba', contrasena: 'clave-de-prueba-2', empleado: ['Claudio', 'Espinosa'], rol: 'empleado' },
  dueno: { username: 'dueno.prueba', contrasena: 'clave-de-prueba-3', empleado: ['Rita', null], rol: 'administrador' },
};

module.exports = { urlDePrueba, nombreDeLaBase, exigirBaseDePrueba, USUARIOS };
