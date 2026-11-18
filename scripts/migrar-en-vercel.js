'use strict';

// Corre las migraciones pendientes antes de cada publicacion en Vercel (lo
// llama "vercel-build" en package.json), como hacia railway.json.
//
//   - Solo en la publicacion de produccion. Las de prueba (preview, una por
//     rama) no tocan la base: si no, una migracion a medio hacer en una rama
//     cambiaria la base que usa el local.
//   - Usa DATABASE_URL_MIGRACIONES, la conexion directa (modo "session") de
//     Supabase: las migraciones necesitan una conexion que dure toda la
//     corrida, y la de DATABASE_URL (modo "transaction") no la da.

const path = require('path');
const { spawnSync } = require('child_process');

if (process.env.VERCEL_ENV !== 'production') {
  console.log('Publicacion de prueba (' + (process.env.VERCEL_ENV || 'sin Vercel') + '): no se corren las migraciones.');
  process.exit(0);
}

const url = process.env.DATABASE_URL_MIGRACIONES;
if (!url) {
  console.error('Falta DATABASE_URL_MIGRACIONES en las variables de entorno de Vercel (ver docs/VERCEL-SUPABASE.md).');
  process.exit(1);
}

const cli = path.join(__dirname, '..', 'node_modules', 'node-pg-migrate', 'bin', 'node-pg-migrate.js');
const resultado = spawnSync(process.execPath, [cli, 'up'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(resultado.status === null ? 1 : resultado.status);
