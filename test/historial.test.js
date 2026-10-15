'use strict';

// Historial de ventas: los filtros, los totales y el detalle de una venta.
//
// Otras pruebas tambien venden en el dia, asi que los totales no se comparan
// contra un numero fijo: se mide cuanto cambian al cargar las ventas de este
// archivo. Asi la prueba no depende de que corrio antes.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, consultar, idProducto, idMedio, cajaNueva } = require('./ayudantes');

let sistema;
let empleado;
let dueno;
let sucursal;
let antes = {};
const ids = {};

// Las busquedas que se miden, como parametros de la direccion.
const BUSQUEDAS = {
  todo: '',
  pedidosya: 'canal=PEDIDOSYA',
  debito: 'medio=DEBITO',
  anuladas: 'estado=anuladas',
  validas: 'estado=validas',
};

async function buscar(dueno, busqueda) {
  const consulta = busqueda.replace('DEBITO', String(await idMedio('Débito')));
  const { estado, html } = await dueno.abrir('/historial?sucursal=' + sucursal + (consulta ? '&' + consulta : ''));
  assert.equal(estado, 200);
  return { html, totales: totalesDe(html), ids: [...html.matchAll(/href="\/historial\/(\d+)\?/g)].map((m) => Number(m[1])) };
}

// "3 ventas por $63.000 · 1 anulada por $4.500" -> numeros.
function totalesDe(html) {
  const texto = /<section class="panel" id="totales">([\s\S]*?)<\/section>/.exec(html)[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const pesos = (t) => Number(t.replace(/[$.]/g, '').replace(',', '.'));
  const [, ventas, monto] = /(\d+) ventas? por (\$[\d.,]+)/.exec(texto);
  const anuladas = /(\d+) anuladas? por (\$[\d.,]+)/.exec(texto);
  return {
    ventas: Number(ventas), monto: pesos(monto),
    anuladas: anuladas ? Number(anuladas[1]) : 0, montoAnuladas: anuladas ? pesos(anuladas[2]) : 0,
  };
}

async function vender(carta, producto, cantidad, campos) {
  await empleado.enviar('/' + carta + '/pedido', { id_sucursal: sucursal, id_producto: producto, accion: 'agregar', cantidad });
  await empleado.enviar('/' + carta + '/cobrar', { id_sucursal: sucursal, ...campos });
  const { rows } = await consultar('SELECT max(id_venta) AS id FROM ventas');
  return rows[0].id;
}

before(async () => {
  sistema = await levantar();
  empleado = new Navegador(sistema.base);
  await empleado.entrar('empleado');
  sucursal = await cajaNueva(empleado);
  dueno = new Navegador(sistema.base);
  await dueno.entrar('dueno');

  for (const [nombre, busqueda] of Object.entries(BUSQUEDAS)) antes[nombre] = (await buscar(dueno, busqueda)).totales;

  const efectivo = await idMedio('Efectivo');
  const debito = await idMedio('Débito');
  ids.efectivo = await vender('ventas', await idProducto('Cono simple'), 2, { canal: 'MOSTRADOR', id_medio_pago: efectivo, paga_con: '$9.000' });
  ids.debito = await vender('ventas', await idProducto('Térmico 1/2 kg'), 1, { canal: 'TELEFONO', id_medio_pago: debito });
  ids.pedidosya = await vender('pedidosya', await idProducto('Familiar 3 lt chocolate, vainilla y dulce de leche'), 1,
    { id_medio_pago: await idMedio('PedidosYa (online)') });
  ids.anulada = await vender('ventas', await idProducto('Cono simple'), 1, { canal: 'MOSTRADOR', id_medio_pago: debito });
  await empleado.enviar('/ventas/' + ids.anulada + '/anular', { motivo: 'cliente se arrepintió' });
});
after(() => sistema.apagar());

// Cuanto cambiaron los totales de una busqueda desde antes de vender.
async function cambio(nombre) {
  const ahora = (await buscar(dueno, BUSQUEDAS[nombre])).totales;
  const a = antes[nombre];
  return { ventas: ahora.ventas - a.ventas, monto: ahora.monto - a.monto, anuladas: ahora.anuladas - a.anuladas, montoAnuladas: ahora.montoAnuladas - a.montoAnuladas };
}

describe('Historial de ventas', () => {
  test('el empleado no puede entrar', async () => {
    assert.equal((await empleado.abrir('/historial')).estado, 403);
    assert.equal((await empleado.abrir('/historial/' + ids.efectivo)).estado, 403);
  });

  test('las anuladas se cuentan aparte y no suman al total', async () => {
    assert.deepEqual(await cambio('todo'), { ventas: 3, monto: 63000, anuladas: 1, montoAnuladas: 4500 });
  });

  test('aparecen las ventas de hoy, con las anuladas marcadas', async () => {
    const { html, ids: lista } = await buscar(dueno, '');
    for (const id of Object.values(ids)) assert.ok(lista.includes(id), 'falta la venta ' + id);
    assert.match(html, /Anuló [^:]+: cliente se arrepintió/);
  });

  test('filtra por canal', async () => {
    assert.deepEqual(await cambio('pedidosya'), { ventas: 1, monto: 39000, anuladas: 0, montoAnuladas: 0 });
    const { ids: lista } = await buscar(dueno, BUSQUEDAS.pedidosya);
    assert.ok(lista.includes(ids.pedidosya));
    assert.ok(!lista.includes(ids.efectivo));
  });

  test('filtra por medio de pago', async () => {
    assert.deepEqual(await cambio('debito'), { ventas: 1, monto: 15000, anuladas: 1, montoAnuladas: 4500 });
  });

  test('filtra solo las anuladas, o sin ellas', async () => {
    assert.deepEqual(await cambio('anuladas'), { ventas: 0, monto: 0, anuladas: 1, montoAnuladas: 4500 });
    assert.deepEqual(await cambio('validas'), { ventas: 3, monto: 63000, anuladas: 0, montoAnuladas: 0 });
  });

  test('con fechas de otro día no aparecen las de hoy', async () => {
    const { html } = await dueno.abrir('/historial?desde=2020-01-01&hasta=2020-01-31');
    assert.match(html, /No hay ventas con estos filtros/);
  });

  test('un filtro que no se entiende no rompe la pantalla', async () => {
    const { estado } = await dueno.abrir('/historial?desde=ayer&canal=CUALQUIERA&pagina=-3&sucursal=xx');
    assert.equal(estado, 200);
  });
});

describe('Detalle de una venta', () => {
  test('muestra lo vendido, cómo se pagó y el turno de caja', async () => {
    const { estado, html } = await dueno.abrir('/historial/' + ids.debito);
    assert.equal(estado, 200);
    const texto = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(texto, /Teléfono en Entre Ríos/);
    assert.match(texto, /Térmico 1\/2 kg 1 \$15\.000 \$15\.000/);
    assert.match(texto, /Débito \$15\.000/);
    assert.match(html, /href="\/caja">Ver el turno de caja/);
  });

  test('una venta anulada dice quién, cuándo y por qué', async () => {
    const { html } = await dueno.abrir('/historial/' + ids.anulada);
    assert.match(html, /Anulada por [^<]+: cliente se arrepintió/);
  });

  test('una venta que no existe da "no encontrado"', async () => {
    assert.equal((await dueno.abrir('/historial/999999')).estado, 404);
  });
});
