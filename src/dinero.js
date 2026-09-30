'use strict';

// Plata en formato argentino: signo pesos, punto para los miles y coma para
// los centavos. $300.000 y $300.000,15. Es el formato en que se escribe en
// los campos y en el que el sistema muestra todos los montos.

const MAXIMO = 9999999999.99; // lo que entra en las columnas NUMERIC(12,2)

// Lee un monto escrito en un campo y lo devuelve como lo guarda la base
// ("300000.15"), o null si no se entiende.
//
// El punto es siempre separador de miles y la coma, de centavos, como se
// escribe en Argentina. Por eso "4000.50" se rechaza en vez de adivinar: si
// se leyera como 4000,50 y quien lo escribio queria decir cuatro millones
// cincuenta, nadie se enteraria del error.
function parsearMonto(valor, { permitirCero = false } = {}) {
  if (typeof valor !== 'string') return null;
  const texto = valor.replace(/[$\s ]/g, '');
  const conMiles = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/;
  const sinMiles = /^\d+(,\d{1,2})?$/;
  if (!conMiles.test(texto) && !sinMiles.test(texto)) return null;

  const normal = texto.replace(/\./g, '').replace(',', '.');
  const numero = Number(normal);
  if (numero > MAXIMO || numero < 0 || (!permitirCero && numero === 0)) return null;
  return normal;
}

const MONTO_INVALIDO = 'escribilo como $300.000 o $300.000,15: el punto separa los miles y la coma, los centavos';

// Un monto para mostrar: $17.500, o $17.500,15 si tiene centavos.
function pesos(valor) {
  const centavos = Math.round(Number(valor) * 100);
  if (!Number.isFinite(centavos)) return '';
  const absoluto = Math.abs(centavos);
  const enteros = String(Math.floor(absoluto / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = absoluto % 100;
  return (centavos < 0 ? '-' : '') + '$' + enteros + (resto ? ',' + String(resto).padStart(2, '0') : '');
}

// Las cuentas de plata se hacen en centavos enteros: sumar decimales en
// JavaScript da cosas como 0.1 + 0.2 = 0.30000000000000004.
function aCentavos(valor) {
  return Math.round(Number(valor) * 100);
}

function textoPesos(centavos) {
  return pesos(centavos / 100);
}

module.exports = { parsearMonto, MONTO_INVALIDO, pesos, aCentavos, textoPesos };
