'use strict';

// Carga el costo de compra de cada insumo, tomado de la hoja COSTOS de la
// planilla de formulaciones artesanales. Con esto y las recetas, el sistema
// puede calcular cuanto cuesta producir un kilo de cada sabor.
//
// Igual que los demas seeds, se puede correr cuantas veces haga falta: si el
// costo no cambio no hace nada, y si cambio cierra el anterior y abre uno
// nuevo para no perder el historial.
//
// Uso: npm run seed:costos-insumo

const { Client } = require('pg');

// Los insumos que en la planilla figuran sin costo quedan afuera a proposito:
// es mejor que el sistema diga "no se" a que invente un numero que despues
// aparezca sumado en el costo de un sabor sin que nadie lo note.
const COSTOS = [
  { insumo: 'Neutro',                   costo: 13300 },
  { insumo: 'Agente de batido',         costo: 13000 },
  { insumo: 'Estabilizante chantilly',  costo: 8200 },
  { insumo: 'Estabilizante vainilla',   costo: 7700 },
  { insumo: 'Estabilizante chocolate',  costo: 16000 },
  { insumo: 'Estabilizante mousse',     costo: 18000 },
  { insumo: 'Azúcar',                   costo: 600 },
  { insumo: 'Leche',                    costo: 6000 },
  { insumo: 'Crema de leche',           costo: 2500 },
  { insumo: 'Dulce de leche heladero',  costo: 2900 },
  { insumo: 'Dulce de leche repostero', costo: 1800 },
  { insumo: 'Pulpa de frutilla',        costo: 2900 },
  { insumo: 'Pulpa de ananá',           costo: 2900 },
  { insumo: 'Pulpa de durazno',         costo: 2900 },
  { insumo: 'Pasta de vainilla',        costo: 9900 },
  { insumo: 'Pasta de arándanos',       costo: 16700 },
  { insumo: 'Pasta de maracuyá',        costo: 14700 },
  { insumo: 'Nutelina base',            costo: 21000 },
  { insumo: 'Chocolate para granizar',  costo: 4000 },
  { insumo: 'Cobertura amarga',         costo: 17000 },
  { insumo: 'Cobertura blanca',         costo: 14400 },
  { insumo: 'Cacao',                    costo: 15000 },
  { insumo: 'Nueces',                   costo: 6000 },
  { insumo: 'Almendras',                costo: 12000 },
  { insumo: 'Pasas',                    costo: 6500 },
  { insumo: 'Galletitas micro',         costo: 6000 },
  { insumo: 'Bizcochuelo',              costo: 10000 },
  { insumo: 'Crocante',                 costo: 6500 },
  { insumo: 'Banana',                   costo: 1200 },
  { insumo: 'Limón',                    costo: 500 },
  { insumo: 'Cerezas',                  costo: 5200 },
  { insumo: 'Kinotos',                  costo: 6000 },
  { insumo: 'Higos',                    costo: 6000 },
  { insumo: 'Champagne',                costo: 3000 },
  { insumo: 'Oreo',                     costo: 900 },
];
async function cargarCosto(client, { insumo, costo }) {
  const prod = await client.query(
    'SELECT id_insumo FROM insumos WHERE nombre = $1',
    [insumo]
  );
  if (prod.rowCount === 0) {
    return { estado: 'SIN PRODUCTO', detalle: insumo };
  }
  const idInsumo = prod.rows[0].id_insumo;

  const vigente = await client.query(
    `SELECT id_costo_insumo, costo FROM costos_insumo
      WHERE id_insumo = $1 AND fecha_vigencia_hasta IS NULL`,
    [idInsumo]
  );

  if (vigente.rowCount > 0) {
    if (Number(vigente.rows[0].costo) === costo) {
      return { estado: 'SIN CAMBIOS', detalle: `${insumo} sigue en $${costo}` };
    }
    // El costo viejo se cierra en lugar de pisarse, para poder responder que
    // margen dejaba un insumo el mes pasado y no solo hoy.
    await client.query(
      'UPDATE costos_insumo SET fecha_vigencia_hasta = CURRENT_DATE WHERE id_costo_insumo = $1',
      [vigente.rows[0].id_costo_insumo]
    );
  }

  await client.query(
    'INSERT INTO costos_insumo (id_insumo, costo) VALUES ($1, $2)',
    [idInsumo, costo]
  );

  return {
    estado: vigente.rowCount > 0 ? 'ACTUALIZADO' : 'NUEVO',
    detalle: vigente.rowCount > 0
      ? `${insumo}: $${vigente.rows[0].costo} -> $${costo}`
      : `${insumo}: $${costo}`,
  };
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');

  let huboProblemas = false;
  for (const fila of COSTOS) {
    const { estado, detalle } = await cargarCosto(client, fila);
    if (estado === 'SIN PRODUCTO') huboProblemas = true;
    console.log(`  ${estado.padEnd(13)} ${detalle}`);
  }

  if (huboProblemas) {
    await client.query('ROLLBACK');
    console.error('\nNo se cargó nada: hay insumos que no existen en la base.');
    process.exit(1);
  }

  await client.query('COMMIT');
  await client.end();
  console.log('\nCostos de insumos al día.');
})().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
