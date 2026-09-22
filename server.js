'use strict';

// Punto de arranque del servidor. Se separa de src/app.js a proposito: app.js
// arma la aplicacion y no escucha en ningun puerto, asi el dia que haya tests
// se la puede levantar sin ocupar el 3000.
const { crearAplicacion } = require('./src/app');

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. Revisa el .env (ver .env.example).');
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error('Falta SESSION_SECRET. Revisa el .env (ver .env.example).');
  process.exit(1);
}

const PUERTO = process.env.PORT || 3000;

crearAplicacion().listen(PUERTO, () => {
  console.log(`Kokino andando en http://localhost:${PUERTO}`);
});
