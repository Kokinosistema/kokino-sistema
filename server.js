'use strict';

// Punto de arranque del servidor. Se separa de src/app.js a proposito: app.js
// arma la aplicacion y no escucha en ningun puerto, asi el dia que haya tests
// se la puede levantar sin ocupar el 3000.
// Hora argentina siempre, no la de la computadora donde corra: en un servidor
// en la nube suele estar en UTC, y una venta de las 23 h caeria al dia
// siguiente. Va antes de cargar nada, para que todo la use. Pisa la TZ que
// traiga el servidor; si alguna vez hiciera falta otra, va en ZONA_HORARIA.
process.env.TZ = process.env.ZONA_HORARIA || 'America/Argentina/Tucuman';

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
