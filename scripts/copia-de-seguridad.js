'use strict';

// Copia de seguridad de la base (2026-10-07). Guarda un archivo con toda la
// base (pg_dump en formato comprimido) en la carpeta de copias, borra las de
// mas de N dias y deja anotado como salio en ultima-copia.json, que el Inicio
// de los duenos lee para avisar si la ultima copia fallo o es vieja.
//
// Uso:   npm run copia
// Se programa para que corra sola una vez por dia (ver docs/INSTALACION.md).
//
// Configuracion (en el .env, todas opcionales):
//   CARPETA_COPIAS  donde se guardan (por defecto, la carpeta "copias-kokino"
//                   al lado del proyecto, fuera del repositorio). Si es la
//                   carpeta de Google Drive u OneDrive, quedan tambien en la nube.
//   DIAS_COPIAS     cuantos dias se guardan (por defecto, 30).
//   PG_BIN          carpeta de los programas de PostgreSQL, si pg_dump no
//                   esta en el PATH (en Windows se busca sola en Program Files).
//
// Para volver a una copia, ver "Restaurar una copia" en docs/INSTALACION.md.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { carpetaDeCopias, ARCHIVO_ESTADO } = require('../src/copias');

const DIAS = Number(process.env.DIAS_COPIAS) > 0 ? Number(process.env.DIAS_COPIAS) : 30;

// pg_dump: el de PG_BIN, el del PATH, o el de la instalacion de Windows mas nueva.
function programa(nombre) {
  const exe = process.platform === 'win32' ? nombre + '.exe' : nombre;
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, exe);
  const enPath = spawnSync(exe, ['--version'], { encoding: 'utf8' });
  if (enPath.status === 0) return exe;
  if (process.platform === 'win32') {
    const base = 'C:/Program Files/PostgreSQL';
    if (fs.existsSync(base)) {
      const versiones = fs.readdirSync(base).filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a));
      for (const v of versiones) {
        const candidato = path.join(base, v, 'bin', exe);
        if (fs.existsSync(candidato)) return candidato;
      }
    }
  }
  return exe;
}

function marca() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()) + '_' + dos(d.getHours()) + dos(d.getMinutes()) + dos(d.getSeconds());
}

// Los mensajes de pg_dump en Windows vienen en la codificacion de la consola
// (latin1), no en UTF-8: si no se leen como UTF-8, se leen como latin1.
function texto(buffer) {
  if (!buffer || buffer.length === 0) return '';
  const utf8 = buffer.toString('utf8');
  return utf8.includes('�') ? buffer.toString('latin1') : utf8;
}

function anotar(carpeta, estado) {
  try {
    fs.writeFileSync(path.join(carpeta, ARCHIVO_ESTADO), JSON.stringify(estado, null, 2));
  } catch (error) {
    console.error('No se pudo anotar el resultado de la copia:', error.message);
  }
}

function principal() {
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL. Revisa el .env.');
    process.exit(1);
  }
  const carpeta = carpetaDeCopias();
  fs.mkdirSync(carpeta, { recursive: true });
  // Se escribe con un nombre temporal y se renombra recien si salio bien: una
  // copia que falla a la mitad nunca queda como si fuera buena, y nunca se
  // toca un archivo que ya estaba.
  const archivo = path.join(carpeta, 'kokino-' + marca() + '.dump');
  const temporal = archivo + '.parcial';

  const resultado = spawnSync(programa('pg_dump'), ['--format=custom', '--no-owner', '--file=' + temporal, process.env.DATABASE_URL]);
  const tamano = fs.existsSync(temporal) ? fs.statSync(temporal).size : 0;
  if (resultado.error || resultado.status !== 0 || tamano === 0) {
    const motivo = (resultado.error && resultado.error.message) || texto(resultado.stderr).trim() || 'pg_dump no generó el archivo';
    if (fs.existsSync(temporal)) fs.unlinkSync(temporal);
    anotar(carpeta, { ok: false, fecha: new Date().toISOString(), error: motivo });
    console.error('La copia de seguridad FALLÓ: ' + motivo);
    process.exit(1);
  }
  fs.renameSync(temporal, archivo);

  // Borra las copias de mas de DIAS dias (solo las suyas: kokino-*.dump).
  const limite = Date.now() - DIAS * 24 * 60 * 60 * 1000;
  let borradas = 0;
  for (const nombre of fs.readdirSync(carpeta)) {
    if (!/^kokino-.*\.dump$/.test(nombre)) continue;
    const ruta = path.join(carpeta, nombre);
    if (ruta !== archivo && fs.statSync(ruta).mtimeMs < limite) {
      fs.unlinkSync(ruta);
      borradas += 1;
    }
  }

  anotar(carpeta, { ok: true, fecha: new Date().toISOString(), archivo: path.basename(archivo), bytes: tamano });
  console.log('Copia guardada: ' + archivo + ' (' + Math.round(tamano / 1024) + ' KB).'
    + (borradas ? ' Se borraron ' + borradas + ' copias de más de ' + DIAS + ' días.' : ''));
}

principal();
