'use strict';

// Carga el costo de compra de los productos que Kokino revende, para poder
// saber que margen deja cada uno. Igual que el de precios, se puede correr
// todas las veces que haga falta: si el costo no cambio no hace nada, y si
// cambio cierra el anterior y abre uno nuevo, para no perder el historial.
//
// Solo se cargan costos de la reposteria comprada, que es donde los duenos
// miran el margen. Los insumos del helado no llevan costo: esa decision esta
// explicada en la migracion que crea costos_producto.
//
// Uso: npm run seed:costos

const { Client } = require('pg');

// Los productos sin costo cargado en Fudo quedan afuera a proposito: es mejor
// que el sistema diga "no se" a que invente un numero. El margen de esos
// productos simplemente no se va a poder calcular hasta que alguien lo cargue.
const COSTOS = [
  { producto: 'Chocotorta',                        costo: 20500 },
  { producto: 'Lemon curd',                        costo: 13650 },
  { producto: 'Rogel',                             costo: 12850 },
  { producto: 'Leche condensada',                  costo: 6670 },
  { producto: 'Brownie con merengue',              costo: 4680 },
  { producto: 'Chocotorta pequeña',                costo: 4090 },
  { producto: 'Volcán',                            costo: 2840 },
  { producto: 'Lemon curd pequeño',                costo: 2730 },
  { producto: 'Brownie con nuez pequeño',          costo: 2720 },
  { producto: 'Brownie con helado',                costo: 2720 },
  { producto: 'Coco y dulce de leche',             costo: 2405 },
  { producto: 'Cheesecake pequeño',                costo: 2300 },
  { producto: 'Alfajor grande',                    costo: 2210 },
  { producto: 'Rogel chico',                       costo: 1500 },
  { producto: 'Tarta de leche condensada pequeña', costo: 1403 },
  { producto: 'Galletas choco',                    costo: 1145 },
];

async function cargarCosto(client, { producto, costo }) {
  const prod = await client.query(
    'SELECT id_producto FROM productos WHERE nombre = $1',
    [producto]
  );
  if (prod.rowCount === 0) {
    return { estado: 'SIN PRODUCTO', detalle: producto };
  }
  const idProducto = prod.rows[0].id_producto;

  const vigente = await client.query(
    `SELECT id_costo, costo FROM costos_producto
      WHERE id_producto = $1 AND fecha_vigencia_hasta IS NULL`,
    [idProducto]
  );

  if (vigente.rowCount > 0) {
    if (Number(vigente.rows[0].costo) === costo) {
      return { estado: 'SIN CAMBIOS', detalle: `${producto} sigue en $${costo}` };
    }
    // El costo viejo se cierra en lugar de pisarse, para poder responder que
    // margen dejaba un producto el mes pasado y no solo hoy.
    await client.query(
      'UPDATE costos_producto SET fecha_vigencia_hasta = CURRENT_DATE WHERE id_costo = $1',
      [vigente.rows[0].id_costo]
    );
  }

  await client.query(
    'INSERT INTO costos_producto (id_producto, costo) VALUES ($1, $2)',
    [idProducto, costo]
  );

  return {
    estado: vigente.rowCount > 0 ? 'ACTUALIZADO' : 'NUEVO',
    detalle: vigente.rowCount > 0
      ? `${producto}: $${vigente.rows[0].costo} -> $${costo}`
      : `${producto}: $${costo}`,
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
    console.error('\nNo se cargó nada: hay productos que no existen en la base.');
    process.exit(1);
  }

  await client.query('COMMIT');
  await client.end();
  console.log('\nCostos al día.');
})().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
