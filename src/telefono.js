'use strict';

// Validacion del telefono, compartida por clientes y proveedores, igual que
// el CUIT (src/cuit.js): tenerla dos veces garantiza que algun dia una de las
// dos se corrija y la otra no.

// 15 es el largo maximo de un numero internacional; un celular de Tucuman
// con caracteristica tiene 10 (381 y el numero). Menos de 6 es casi seguro
// un numero cortado.
const MINIMO = 6;
const MAXIMO = 15;

// Devuelve { telefono } o { error } con un mensaje para mostrar tal cual.
// El vacio es valido: el telefono no es obligatorio.
function normalizarTelefono(entrada) {
  const texto = (entrada || '').trim();
  if (texto === '') return { telefono: null };
  if (/\D/.test(texto)) return { error: 'El teléfono solo puede tener números, sin letras, espacios ni guiones.' };
  if (texto.length < MINIMO) return { error: 'Al teléfono le faltan números: tiene ' + texto.length + '.' };
  if (texto.length > MAXIMO) return { error: 'El teléfono tiene demasiados números: ' + MAXIMO + ' como mucho.' };
  return { telefono: texto };
}

module.exports = { normalizarTelefono, MAXIMO };
