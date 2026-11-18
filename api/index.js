'use strict';

// Punto de entrada en Vercel (2026-11-03). Hace lo mismo que server.js, pero
// en vez de quedarse escuchando en un puerto le entrega la aplicacion a
// Vercel, que la prende cuando llega una visita (ver vercel.json y
// docs/VERCEL-SUPABASE.md). En la compu y en una PC del local se sigue
// usando server.js.

// Hora argentina siempre, como en server.js: los servidores de Vercel estan
// en UTC. Va antes de cargar nada, para que todo la use.
process.env.TZ = process.env.ZONA_HORARIA || 'America/Argentina/Tucuman';

for (const variable of ['DATABASE_URL', 'SESSION_SECRET']) {
  if (!process.env[variable]) {
    throw new Error('Falta ' + variable + ' en las variables de entorno de Vercel (ver docs/VERCEL-SUPABASE.md).');
  }
}

const { crearAplicacion } = require('../src/app');

module.exports = crearAplicacion();
