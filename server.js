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

const servidor = crearAplicacion().listen(PUERTO, () => {
  console.log(`Kokino andando en http://localhost:${PUERTO}`);
});

// Al apagarlo (o al reiniciarlo el administrador de procesos) termina de
// atender lo que estaba en curso y cierra las conexiones a la base, en vez
// de cortar una venta a la mitad.
function apagar(senal) {
  console.log(`Kokino se apaga (${senal})...`);
  servidor.close(() => {
    require('./src/db').pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => apagar('SIGINT'));
process.on('SIGTERM', () => apagar('SIGTERM'));
