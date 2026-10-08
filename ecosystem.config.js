'use strict';

// Configuracion de PM2, el administrador de procesos con el que corre Kokino
// cuando se usa de verdad (ver docs/INSTALACION.md):
//   - lo reinicia solo si se cae,
//   - lo arranca con la computadora (pm2 startup / pm2-installer en Windows),
//   - guarda los registros en la carpeta logs.
// Sirve igual en Windows y en Linux. Las variables (DATABASE_URL,
// SESSION_SECRET, ...) las lee del .env, como en desarrollo.

module.exports = {
  apps: [
    {
      name: 'kokino',
      script: 'server.js',
      node_args: '--env-file=.env',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      max_memory_restart: '400M',
      kill_timeout: 10000,
      out_file: 'logs/kokino.log',
      error_file: 'logs/kokino-errores.log',
      time: true,
    },
  ],
};
