'use strict';

// Donde estan las copias de seguridad y como salio la ultima. Lo usan el
// script que las hace (scripts/copia-de-seguridad.js) y el Inicio de los
// duenos, que avisa si la ultima copia fallo o tiene mas de dos dias.

const fs = require('fs');
const path = require('path');

const ARCHIVO_ESTADO = 'ultima-copia.json';
const DIAS_PARA_AVISAR = 2;

// Por defecto, una carpeta al lado del proyecto (fuera del repositorio, para
// que las copias nunca se suban a GitHub).
function carpetaDeCopias() {
  return process.env.CARPETA_COPIAS || path.join(__dirname, '..', '..', 'copias-kokino');
}

// null si esta todo bien; si no, un texto para mostrar.
function avisoDeCopias() {
  // En Vercel no hay carpeta propia donde guardarlas: las copias las hace
  // Supabase (ver docs/VERCEL-SUPABASE.md) y este aviso no aplica.
  if (process.env.VERCEL) return null;
  let estado;
  try {
    estado = JSON.parse(fs.readFileSync(path.join(carpetaDeCopias(), ARCHIVO_ESTADO), 'utf8'));
  } catch (error) {
    return 'Todavía no se hizo ninguna copia de seguridad de la base. Si se rompe la computadora, se pierde todo: hay que programar la copia diaria (ver docs/INSTALACION.md).';
  }
  const fecha = new Date(estado.fecha);
  if (!estado.ok) {
    return 'La última copia de seguridad (' + fecha.toLocaleString('es-AR', { hour12: false }) + ') falló: ' + estado.error;
  }
  const dias = Math.floor((Date.now() - fecha.getTime()) / (24 * 60 * 60 * 1000));
  if (dias >= DIAS_PARA_AVISAR) {
    return 'La última copia de seguridad es del ' + fecha.toLocaleDateString('es-AR') + ' (hace ' + dias + ' días): revisá que la copia diaria esté funcionando.';
  }
  return null;
}

module.exports = { carpetaDeCopias, avisoDeCopias, ARCHIVO_ESTADO };
