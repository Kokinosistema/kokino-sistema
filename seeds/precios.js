'use strict';

// Carga los precios de lista vigentes. A diferencia de una migración, este
// script se puede correr todas las veces que haga falta: si el precio no
// cambió no hace nada, y si cambió cierra el anterior y abre uno nuevo, para
// que las ventas viejas se sigan pudiendo valuar con el precio que tenían.
//
// Uso: npm run seed:precios

const { Client } = require('pg');

const PRECIOS = [
  { producto: 'Térmico 1/4 kg', tipo: 'MINORISTA', precio: 10000 },
  { producto: 'Térmico 1/2 kg', tipo: 'MINORISTA', precio: 15000 },
  { producto: 'Térmico 1 kg',   tipo: 'MINORISTA', precio: 25000 },

  { producto: 'Cono simple',      tipo: 'MINORISTA', precio: 4500 },
  { producto: 'Mini cucuruchón',  tipo: 'MINORISTA', precio: 5000 },
  { producto: 'Cono americano',   tipo: 'MINORISTA', precio: 6500 },
  { producto: 'Vasito',           tipo: 'MINORISTA', precio: 6500 },
  { producto: 'Vaso',             tipo: 'MINORISTA', precio: 7500 },
  { producto: 'Cucuruchón doble', tipo: 'MINORISTA', precio: 7500 },
  { producto: 'Cono triple',      tipo: 'MINORISTA', precio: 8000 },
  { producto: 'Barquillo',        tipo: 'MINORISTA', precio: 8000 },

  // El precio del familiar depende del tamaño y no de la combinación: los tres
  // de 3 litros valen igual. Son productos separados porque el stock los
  // distingue, aunque el precio los agrupe.
  { producto: 'Familiar 3 lt americana, vainilla y dulce de leche', tipo: 'MINORISTA', precio: 36000 },
  { producto: 'Familiar 3 lt chocolate, vainilla y dulce de leche', tipo: 'MINORISTA', precio: 36000 },
  { producto: 'Familiar 3 lt chocolate, vainilla y frutilla',       tipo: 'MINORISTA', precio: 36000 },
  { producto: 'Familiar 5 lt americana, vainilla y dulce de leche', tipo: 'MINORISTA', precio: 50000 },
  { producto: 'Familiar 5 lt chocolate, vainilla y dulce de leche', tipo: 'MINORISTA', precio: 50000 },
  { producto: 'Familiar 5 lt chocolate, vainilla y frutilla',       tipo: 'MINORISTA', precio: 50000 },

  { producto: 'Diet 250 cc chocolate y vainilla',      tipo: 'MINORISTA', precio: 14000 },
  { producto: 'Diet 250 cc ananá y durazno',           tipo: 'MINORISTA', precio: 14000 },
  { producto: 'Diet 250 cc dulce de leche y frutilla', tipo: 'MINORISTA', precio: 14000 },

  // Cafetería. El combo de jarrito con alfajor vale lo mismo que el affogato.
  { producto: 'Café chico',        tipo: 'MINORISTA', precio: 2500 },
  { producto: 'Jarrito',           tipo: 'MINORISTA', precio: 3000 },
  { producto: 'Jarrito y alfajor', tipo: 'MINORISTA', precio: 5000 },
  { producto: 'Affogato',          tipo: 'MINORISTA', precio: 5000 },

  // El precio del palito depende de la familia y no del gusto: los tres
  // frutales valen igual, igual que los dos de crema. Son productos separados
  // porque el stock los distingue, aunque el precio los agrupe.
  { producto: 'Palito frutal limón',       tipo: 'MINORISTA', precio: 3500 },
  { producto: 'Palito frutal frutilla',    tipo: 'MINORISTA', precio: 3500 },
  { producto: 'Palito frutal ananá',       tipo: 'MINORISTA', precio: 3500 },
  { producto: 'Palito de crema americana', tipo: 'MINORISTA', precio: 4000 },
  { producto: 'Palito de crema vainilla',  tipo: 'MINORISTA', precio: 4000 },
  { producto: 'Palito bombón',             tipo: 'MINORISTA', precio: 4500 },

  // Los alfajores de produccion propia valen lo mismo sin importar el sabor.
  { producto: 'Alfajor marroc',                    tipo: 'MINORISTA', precio: 3000 },
  { producto: 'Alfajor chocolate blanco con nuez', tipo: 'MINORISTA', precio: 3000 },
  { producto: 'Alfajor chocolate',                 tipo: 'MINORISTA', precio: 3000 },
];

async function cargarPrecio(client, { producto, tipo, precio }) {
  const prod = await client.query(
    'SELECT id_producto FROM productos WHERE nombre = $1',
    [producto]
  );
  if (prod.rowCount === 0) {
    return { estado: 'SIN PRODUCTO', detalle: producto };
  }
  const idProducto = prod.rows[0].id_producto;

  const vigente = await client.query(
    `SELECT id_precio, precio FROM precios
      WHERE id_producto = $1 AND tipo_precio = $2 AND fecha_vigencia_hasta IS NULL`,
    [idProducto, tipo]
  );

  if (vigente.rowCount > 0) {
    if (Number(vigente.rows[0].precio) === precio) {
      return { estado: 'SIN CAMBIOS', detalle: `${producto} sigue en $${precio}` };
    }
    // El precio viejo se cierra en lugar de pisarse: si se sobrescribiera, una
    // venta de la semana pasada quedaría valuada al precio de hoy.
    await client.query(
      'UPDATE precios SET fecha_vigencia_hasta = CURRENT_DATE WHERE id_precio = $1',
      [vigente.rows[0].id_precio]
    );
  }

  await client.query(
    'INSERT INTO precios (id_producto, tipo_precio, precio) VALUES ($1, $2, $3)',
    [idProducto, tipo, precio]
  );

  return {
    estado: vigente.rowCount > 0 ? 'ACTUALIZADO' : 'NUEVO',
    detalle: vigente.rowCount > 0
      ? `${producto}: $${vigente.rows[0].precio} -> $${precio}`
      : `${producto}: $${precio}`,
  };
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');

  let huboProblemas = false;
  for (const fila of PRECIOS) {
    const { estado, detalle } = await cargarPrecio(client, fila);
    if (estado === 'SIN PRODUCTO') huboProblemas = true;
    console.log(`  ${estado.padEnd(13)} ${detalle}`);
  }

  if (huboProblemas) {
    // Si algún producto no existe, no se carga nada: es preferible una lista de
    // precios completa o ninguna, antes que media cargada sin que se note.
    await client.query('ROLLBACK');
    console.error('\nNo se cargó nada: hay productos que no existen en la base.');
    process.exit(1);
  }

  await client.query('COMMIT');
  await client.end();
  console.log('\nPrecios al día.');
})().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
