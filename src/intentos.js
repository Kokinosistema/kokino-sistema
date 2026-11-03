'use strict';

// Limite de intentos de login (pedido de la usuaria el 2026-10-15): despues
// de 5 contrasenas equivocadas en 15 minutos, ese usuario queda bloqueado 5
// minutos. Asi adivinar una contrasena probando deja de ser posible (unos
// 1.400 intentos por dia como mucho).
//
//   - Se cuenta por usuario y no por computadora: en la heladeria todas las
//     PCs salen con la misma direccion, y contar por direccion haria que un
//     error en una caja bloquee a todos.
//   - El bloqueo es corto y se levanta solo: si fuera permanente, cualquiera
//     podria dejar a un dueno sin entrar tipeando mal su usuario a proposito.
//   - Vale tambien para usuarios que no existen, para no revelar cuales si.
//   - Se guarda en la base (tabla intentos_login) y no en la memoria: en
//     Vercel corren varias copias del sistema a la vez y tienen que contar
//     juntas.
//
// La hora se pasa desde aca (y no se usa now() de la base) para que las
// pruebas puedan inventarla.

const { consultar } = require('./db');

const MAXIMO = 5;
const VENTANA_S = 15 * 60;
const BLOQUEO_S = 5 * 60;

const clave = (usuario) => String(usuario || '').trim().toLowerCase();
const momento = 'to_timestamp($2::float8 / 1000)';

// Cuantos minutos le faltan al usuario para poder probar de nuevo, o 0 si
// puede probar ya.
async function minutosBloqueado(usuario, ahora = Date.now()) {
  const { rows: [f] } = await consultar(
    'SELECT hasta FROM intentos_login WHERE usuario = $1', [clave(usuario)]
  );
  if (!f || !f.hasta || f.hasta.getTime() <= ahora) return 0;
  return Math.ceil((f.hasta.getTime() - ahora) / 60000);
}

async function anotarFallo(usuario, ahora = Date.now()) {
  // Lo vencido se borra de paso, para que la tabla no crezca sin fin.
  await consultar(
    `DELETE FROM intentos_login
      WHERE usuario <> $1
        AND desde + make_interval(secs => $3) <= ${momento}
        AND (hasta IS NULL OR hasta <= ${momento})`,
    [clave(usuario), ahora, VENTANA_S]
  );
  // Pasada la ventana (o el bloqueo), se arranca a contar de nuevo. Va en una
  // sola consulta para que dos errores al mismo tiempo no se pisen. En el
  // UPDATE, "i" es la fila como estaba y "EXCLUDED" el error de ahora.
  const reiniciar = `(i.desde + make_interval(secs => $4) <= EXCLUDED.desde
                      OR (i.hasta IS NOT NULL AND i.hasta <= EXCLUDED.desde))`;
  const veces = `CASE WHEN ${reiniciar} THEN 1 ELSE i.veces + 1 END`;
  await consultar(
    `INSERT INTO intentos_login AS i (usuario, veces, desde, hasta)
     VALUES ($1, 1, ${momento}, CASE WHEN 1 >= $3 THEN ${momento} + make_interval(secs => $5) END)
     ON CONFLICT (usuario) DO UPDATE SET
       veces = ${veces},
       desde = CASE WHEN ${reiniciar} THEN EXCLUDED.desde ELSE i.desde END,
       hasta = CASE WHEN ${veces} >= $3 THEN EXCLUDED.desde + make_interval(secs => $5) END`,
    [clave(usuario), ahora, MAXIMO, VENTANA_S, BLOQUEO_S]
  );
}

// Al entrar bien, el contador vuelve a cero.
async function olvidar(usuario) {
  await consultar('DELETE FROM intentos_login WHERE usuario = $1', [clave(usuario)]);
}

module.exports = { minutosBloqueado, anotarFallo, olvidar, MAXIMO };
