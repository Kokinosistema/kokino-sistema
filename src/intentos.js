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
//   - Vive en la memoria del servidor: corre en una sola PC, y si se
//     reinicia los contadores vuelven a cero, que no es un riesgo real.

const MAXIMO = 5;
const VENTANA_MS = 15 * 60 * 1000;
const BLOQUEO_MS = 5 * 60 * 1000;
// Un tope para la memoria, por si alguien prueba miles de usuarios inventados.
const TOPE_DE_USUARIOS = 10000;

const fallos = new Map(); // usuario -> { veces, desde, hasta }

const clave = (usuario) => String(usuario || '').trim().toLowerCase();

// Saca lo vencido, para que el mapa no crezca sin fin.
function limpiar(ahora) {
  for (const [usuario, f] of fallos) {
    if ((f.hasta || 0) <= ahora && f.desde + VENTANA_MS <= ahora) fallos.delete(usuario);
  }
}

// Cuantos minutos le faltan al usuario para poder probar de nuevo, o 0 si
// puede probar ya.
function minutosBloqueado(usuario, ahora = Date.now()) {
  const f = fallos.get(clave(usuario));
  if (!f || !f.hasta || f.hasta <= ahora) return 0;
  return Math.ceil((f.hasta - ahora) / 60000);
}

function anotarFallo(usuario, ahora = Date.now()) {
  if (fallos.size >= TOPE_DE_USUARIOS) limpiar(ahora);
  const k = clave(usuario);
  let f = fallos.get(k);
  // Pasada la ventana (o el bloqueo), se arranca a contar de nuevo.
  if (!f || f.desde + VENTANA_MS <= ahora || (f.hasta && f.hasta <= ahora)) {
    f = { veces: 0, desde: ahora, hasta: null };
    fallos.set(k, f);
  }
  f.veces += 1;
  if (f.veces >= MAXIMO) f.hasta = ahora + BLOQUEO_MS;
}

// Al entrar bien, el contador vuelve a cero.
function olvidar(usuario) {
  fallos.delete(clave(usuario));
}

module.exports = { minutosBloqueado, anotarFallo, olvidar, MAXIMO };
