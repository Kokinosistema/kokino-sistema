'use strict';

// Un monto de plata valido: positivo y con dos decimales como mucho. Se
// valida el texto, no el numero, porque Number('4000.555') no avisa que
// sobra un decimal.
function montoValido(valor) {
  return typeof valor === 'string' && /^\d+(\.\d{1,2})?$/.test(valor.trim()) && Number(valor) > 0;
}

// Las cuentas de plata se hacen en centavos enteros: sumar decimales en
// JavaScript da cosas como 0.1 + 0.2 = 0.30000000000000004.
function aCentavos(valor) {
  return Math.round(Number(valor) * 100);
}

function textoPesos(centavos) {
  return '$' + (centavos / 100).toFixed(2);
}

module.exports = { montoValido, aCentavos, textoPesos };
