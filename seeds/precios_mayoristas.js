'use strict';

// Carga los precios mayoristas por sabor del Excel "Precios 22/04/26 Terminal"
// (los mismos del Sistema Rody, confirmados vigentes por la usuaria el
// 2026-10-22). Igual que seed:precios, se puede correr todas las veces que haga
// falta: si un precio no cambió no hace nada, y si cambió cierra el anterior y
// abre uno nuevo.
//
// Ojo: una vez que los dueños cambien precios desde el sistema, correr este
// script vuelve a poner los de esta lista. Los precios que no figuran acá no
// se tocan.
//
// Uso: npm run seed:precios-mayoristas

const { Client } = require('pg');

const LISTA_GENERAL = 'Lista general';
const LISTA_TERMINAL = 'Lista Terminal';

// Cada fila es un renglón del Excel, con los nombres de Kokino:
// [sabor familiar, sabor artesanal, Terminal, general familiar, general artesanal].
// null en un nombre: ese sabor todavía no existe en esa línea. null en un
// precio: no tiene precio en esa lista (lo definen los dueños).
//
// Faltan los sabores que hay que confirmar con los dueños: Tentación,
// Maracuyá, Amargo, Higos al coñac, Cerezas a la crema, Coco y dulce de leche
// y la Frutilla familiar. Crema Rusa no se vende.
const FILAS = [
  ['Ananá',                    'Ananá',                    41000, 26000, 31200],
  ['Durazno',                  'Durazno',                  41000, 26000, 31200],
  ['Limón',                    'Limón',                    41000, 26000, 31200],
  ['Frutilla al agua',         'Frutilla al agua',         41000, 26000, 31200],
  ['Ananá al champagne',       'Ananá al champagne',       46000, 35000, 42000],
  ['Arándanos',                'Arándanos',                46000, 35000, 42000],
  ['Vainilla',                 'Vainilla',                 48000, 35000, 42000],
  ['Americana',                'Americana',                48000, 35000, 42000],
  ['Flan al caramelo',         'Flan al caramelo',         52000, 35000, 42000],
  ['Granizado',                'Granizado',                52000, 35000, 42000],
  ['Banana split',             'Banana split',             52000, 35000, 42000],
  ['Frutos del bosque',        'Frutos del bosque',        52000, 35000, 42000],
  [null,                       'Frutilla a la crema',      null,  null,  42000],
  ['Crema del cielo',          'Crema del cielo',          52000, 35000, 42000],
  ['Chocolate',                'Chocolate clásico',        58000, 40000, 48000],
  ['Dulce de leche',           'Dulce de leche clásico',   58000, 40000, 48000],
  ['Dulce de leche granizado', 'Dulce de leche granizado', 60000, 40000, 48000],
  ['Chocolate blanco',         'Chocolate blanco',         58000, 40000, 48000],
  ['Dulce de leche goloso',    'Dulce de leche goloso',    60000, null,  null],
  ['Mousse de limón',          'Mousse de limón',          60000, 40000, 48000],
  ['Dulce de leche con nuez',  'Dulce de leche con nuez',  60000, 48000, 57600],
  ['Menta granizada',          'Menta granizada',          60000, null,  null],
  ['Crema Kokino',             'Crema Kokino',             60000, null,  null],
  ['Kokicukis',                'Kokicukis',                60000, null,  null],
  ['Almendrado',               'Almendrado',               60000, 48000, 57600],
  ['Chocotorta',               'Chocotorta',               60000, null,  null],
  ['Melón',                    'Melón',                    65000, 48000, 57600],
  ['Crema oriental',           'Crema oriental',           65000, 48000, 57600],
  ['Kinotos al wisky',         'Kinotos al wisky',         58000, 48000, 57600],
  ['Chocolate a la cubana',    'Chocolate a la cubana',    58000, 48000, 57600],
  ['Chocolate con almendras',  'Chocolate con almendras',  65000, 48000, 57600],
  ['Sambayón',                 'Sambayón',                 70000, 60000, 72000],
  ['Bombón Rocher',            'Bombón Rocher',            80000, 60000, 72000],
];

// El envase que el cliente compra (se lo queda).
const PRECIO_ENVASE = 5000;

// Cada fila se abre en hasta tres precios: Terminal y general son del sabor
// familiar; el artesanal solo está en la general.
function preciosDe([familiar, artesanal, terminal, generalFamiliar, generalArtesanal]) {
  return [
    { lista: LISTA_TERMINAL, sabor: familiar, linea: 'FAMILIAR', precio: terminal },
    { lista: LISTA_GENERAL, sabor: familiar, linea: 'FAMILIAR', precio: generalFamiliar },
    { lista: LISTA_GENERAL, sabor: artesanal, linea: 'ARTESANAL', precio: generalArtesanal },
  ].filter((p) => p.sabor !== null && p.precio !== null);
}

async function cargarPrecio(client, { lista, sabor, linea, precio }) {
  const nombre = `${sabor} (${linea.toLowerCase()}) en ${lista}`;
  const encontrado = await client.query(
    `SELECT s.id_sabor, l.id_lista_precios
       FROM sabores s, listas_precios_mayoristas l
      WHERE s.nombre = $1 AND s.linea = $2 AND l.nombre = $3`,
    [sabor, linea, lista]
  );
  if (encontrado.rowCount === 0) {
    return { estado: 'NO EXISTE', detalle: nombre };
  }
  const { id_sabor: idSabor, id_lista_precios: idLista } = encontrado.rows[0];

  const vigente = await client.query(
    `SELECT id_precio_lista, precio FROM precios_lista_mayorista
      WHERE id_lista_precios = $1 AND id_sabor = $2 AND fecha_vigencia_hasta IS NULL`,
    [idLista, idSabor]
  );

  if (vigente.rowCount > 0) {
    if (Number(vigente.rows[0].precio) === precio) {
      return { estado: 'SIN CAMBIOS', detalle: `${nombre} sigue en $${precio}` };
    }
    // El precio viejo se cierra en lugar de pisarse, como en seed:precios.
    await client.query(
      'UPDATE precios_lista_mayorista SET fecha_vigencia_hasta = CURRENT_DATE WHERE id_precio_lista = $1',
      [vigente.rows[0].id_precio_lista]
    );
  }

  await client.query(
    'INSERT INTO precios_lista_mayorista (id_lista_precios, id_sabor, precio) VALUES ($1, $2, $3)',
    [idLista, idSabor, precio]
  );

  return {
    estado: vigente.rowCount > 0 ? 'ACTUALIZADO' : 'NUEVO',
    detalle: vigente.rowCount > 0
      ? `${nombre}: $${vigente.rows[0].precio} -> $${precio}`
      : `${nombre}: $${precio}`,
  };
}

async function cargarEnvase(client) {
  const vigente = await client.query(
    'SELECT id_precio_envase, precio FROM precios_envase_mayorista WHERE fecha_vigencia_hasta IS NULL'
  );
  if (vigente.rowCount > 0) {
    if (Number(vigente.rows[0].precio) === PRECIO_ENVASE) {
      return { estado: 'SIN CAMBIOS', detalle: `Envase sigue en $${PRECIO_ENVASE}` };
    }
    await client.query(
      'UPDATE precios_envase_mayorista SET fecha_vigencia_hasta = CURRENT_DATE WHERE id_precio_envase = $1',
      [vigente.rows[0].id_precio_envase]
    );
  }
  await client.query('INSERT INTO precios_envase_mayorista (precio) VALUES ($1)', [PRECIO_ENVASE]);
  return {
    estado: vigente.rowCount > 0 ? 'ACTUALIZADO' : 'NUEVO',
    detalle: vigente.rowCount > 0
      ? `Envase: $${vigente.rows[0].precio} -> $${PRECIO_ENVASE}`
      : `Envase: $${PRECIO_ENVASE}`,
  };
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');

  let huboProblemas = false;
  for (const precio of FILAS.flatMap(preciosDe)) {
    const { estado, detalle } = await cargarPrecio(client, precio);
    if (estado === 'NO EXISTE') huboProblemas = true;
    console.log(`  ${estado.padEnd(13)} ${detalle}`);
  }
  const envase = await cargarEnvase(client);
  console.log(`  ${envase.estado.padEnd(13)} ${envase.detalle}`);

  if (huboProblemas) {
    // Si un sabor o una lista no existe, no se carga nada: mejor la lista
    // completa o ninguna, antes que media cargada sin que se note.
    await client.query('ROLLBACK');
    console.error('\nNo se cargó nada: hay sabores o listas que no existen en la base.');
    process.exit(1);
  }

  await client.query('COMMIT');
  await client.end();
  console.log('\nPrecios mayoristas al día.');
})().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
