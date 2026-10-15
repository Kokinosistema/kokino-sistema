'use strict';

// Venta mayorista de tachos (solo duenos): lista de precios, vender a cuenta
// o pagando, cobrar lo que se debe, devolver envases y anular. Usa el Dulce
// de leche de la linea familiar, que no usa ninguna otra prueba.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, erroresDe, consultar, idMedio, idSabor, idSucursal, producir } = require('./ayudantes');

let sistema;
let dueno;
let empleado;
let er;
let ddl;
let conCuenta; // cliente con cuenta corriente
let sinCuenta; // cliente que solo puede pagar en el momento

async function estadoTachos() {
  const { rows } = await consultar(
    `SELECT t.estado, count(*)::int AS n FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote
      WHERE l.id_sabor = $1 GROUP BY t.estado ORDER BY 1`,
    [ddl]
  );
  return Object.fromEntries(rows.map((r) => [r.estado, r.n]));
}

// Arma la venta (con renglones como listas paralelas, igual que el
// formulario), la revisa y la confirma. Devuelve el numero de venta.
function armar(cliente, renglones, pago) {
  const pares = [['id_sucursal', String(er)]];
  for (const r of renglones) {
    pares.push(['renglon_sabor', String(ddl)], ['renglon_envase', r.envase], ['renglon_cantidad', String(r.cantidad)], ['renglon_precio', r.precio]);
  }
  for (const [k, v] of Object.entries(pago)) pares.push([k, String(v)]);
  return dueno.enviar('/clientes/' + cliente + '/vender', pares);
}

async function vender(cliente, renglones, pago) {
  const r = await armar(cliente, renglones, pago);
  assert.equal(r.estado, 302, erroresDe(r.html).join(' '));
  assert.equal((await dueno.abrir('/clientes/' + cliente + '/vender/revisar')).estado, 200);
  const confirmado = await dueno.enviar('/clientes/' + cliente + '/vender/confirmar');
  return Number(/\/clientes\/ventas\/(\d+)$/.exec(confirmado.destino)[1]);
}

before(async () => {
  sistema = await levantar();
  dueno = new Navegador(sistema.base);
  await dueno.entrar('dueno');
  empleado = new Navegador(sistema.base);
  await empleado.entrar('empleado');
  er = await idSucursal('Entre Ríos');
  await dueno.enviar('/sucursal', { id_sucursal: er });
  ddl = await idSabor('Dulce de leche', 'FAMILIAR');
  await producir(dueno, er, 'sabor:' + ddl, 4);
  const { rows } = await consultar(
    `INSERT INTO clientes (nombre_razon_social, tipo_cliente, limite_cuenta_corriente, plazo_pago_dias)
     VALUES ('Kiosco con cuenta', 'MAYORISTA', 100000, 30), ('Kiosco sin cuenta', 'MAYORISTA', NULL, NULL)
     RETURNING id_cliente`
  );
  [conCuenta, sinCuenta] = rows.map((r) => r.id_cliente);
});
after(() => sistema.apagar());

describe('Lista de precios mayoristas', () => {
  test('el empleado no entra', async () => {
    assert.equal((await empleado.abrir('/clientes/precios')).estado, 403);
    assert.equal((await empleado.abrir('/clientes/' + conCuenta + '/vender')).estado, 403);
  });

  test('se cargan los precios y rigen desde hoy', async () => {
    await dueno.enviar('/clientes/precios', { 'FAMILIAR:RETORNABLE': '$30.000', 'FAMILIAR:INCLUIDO': '$38.000' });
    assert.equal(await dueno.aviso('/clientes/precios'), 'Se guardaron 2 precios nuevos. Rigen desde hoy.');
  });

  test('un precio ya cargado no se puede dejar vacío', async () => {
    const r = await dueno.enviar('/clientes/precios', { 'FAMILIAR:RETORNABLE': '', 'FAMILIAR:INCLUIDO': '$38.000' });
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['El precio de familiar con envase retornable no se puede dejar vacío: poné el nuevo precio.']);
  });
});

describe('Vender', () => {
  test('pide al menos un sabor y cómo se paga', async () => {
    const r = await armar(conCuenta, [], {});
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['Agregá al menos un sabor.', 'Elegí si pagó ahora o queda a cuenta.']);
  });

  test('no deja vender más tachos de los que hay', async () => {
    const r = await armar(conCuenta, [{ envase: 'RETORNABLE', cantidad: 5, precio: '$30.000' }], { pago: 'CUENTA' });
    assert.deepEqual(erroresDe(r.html), ['De Dulce de leche (familiar) hay 4 tachos llenos: no se pueden vender 5.']);
  });

  test('a un cliente sin cuenta corriente no se le vende a cuenta', async () => {
    const r = await armar(sinCuenta, [{ envase: 'INCLUIDO', cantidad: 1, precio: '$38.000' }], { pago: 'CUENTA' });
    assert.deepEqual(erroresDe(r.html), ['Kiosco sin cuenta no tiene cuenta corriente habilitada. Para venderle a cuenta, cargale un límite en Editar cliente.']);
  });
});

describe('Venta a cuenta, cobros y envases', () => {
  let venta;

  test('vende 2 tachos retornables a cuenta: salen del stock y quedan debiendo', async () => {
    venta = await vender(conCuenta, [{ envase: 'RETORNABLE', cantidad: 2, precio: '$30.000' }], { pago: 'CUENTA' });
    assert.equal(await dueno.aviso('/clientes/ventas/' + venta),
      'Se registró la venta N° ' + venta + ' a Kiosco con cuenta. Imprimí el remito para que viaje con los tachos.');
    assert.deepEqual(await estadoTachos(), { ENTREGADO_MAYORISTA: 2, LLENO: 2 });
    const { rows } = await consultar('SELECT total FROM ventas_totales WHERE id_venta = $1', [venta]);
    assert.equal(Number(rows[0].total), 60000);
  });

  test('cobra en partes, y no más de lo que se debe', async () => {
    const transferencia = await idMedio('Transferencia o QR');
    await dueno.enviar('/clientes/ventas/' + venta + '/cobros', { monto: '$20.000', id_medio_pago: transferencia });
    assert.equal(await dueno.aviso('/clientes/ventas/' + venta), 'Se registró el cobro. Todavía debe $40.000 de esta venta.');
    const demas = await dueno.enviar('/clientes/ventas/' + venta + '/cobros', { monto: '$50.000', id_medio_pago: transferencia });
    assert.deepEqual(erroresDe(demas.html), ['Debe $40.000 de esta venta: no se le puede cobrar más.']);
    await dueno.enviar('/clientes/ventas/' + venta + '/cobros', { monto: '$40.000', id_medio_pago: transferencia });
    assert.equal(await dueno.aviso('/clientes/ventas/' + venta), 'Se registró el cobro. La venta quedó paga.');
    const otra = await dueno.enviar('/clientes/ventas/' + venta + '/cobros', { monto: '$1', id_medio_pago: transferencia });
    assert.deepEqual(erroresDe(otra.html), ['La venta ya está paga.']);
  });

  test('"PedidosYa (online)" no sirve para cobrar a un mayorista', async () => {
    const r = await armar(conCuenta, [{ envase: 'INCLUIDO', cantidad: 1, precio: '$38.000' }],
      { pago: 'AHORA', id_medio_pago: await idMedio('PedidosYa (online)') });
    assert.deepEqual(erroresDe(r.html), ['Elegí con qué pagó.']);
  });

  test('devuelve los envases retornables, y no más de los que tiene', async () => {
    await dueno.enviar('/clientes/' + conCuenta + '/devoluciones', { cantidad: '3' });
    assert.equal(await dueno.aviso('/clientes/' + conCuenta), 'Kiosco con cuenta tiene 2 envases sin devolver: no puede devolver 3.');
    await dueno.enviar('/clientes/' + conCuenta + '/devoluciones', { cantidad: '2' });
    assert.equal(await dueno.aviso('/clientes/' + conCuenta), 'Se registró la devolución. Ya no debe envases.');
  });
});

describe('Anular una venta mayorista', () => {
  let venta;
  before(async () => {
    venta = await vender(sinCuenta, [{ envase: 'INCLUIDO', cantidad: 1, precio: '$38.000' }],
      { pago: 'AHORA', id_medio_pago: await idMedio('Efectivo') });
  });

  test('pide el motivo', async () => {
    await dueno.enviar('/clientes/ventas/' + venta + '/anular', { motivo: '' });
    assert.equal(await dueno.aviso('/clientes/ventas/' + venta), 'Para anular la venta escribí el motivo.');
  });

  test('al anular, el tacho vuelve al stock y avisa que la plata se devuelve por fuera', async () => {
    assert.deepEqual(await estadoTachos(), { ENTREGADO_MAYORISTA: 3, LLENO: 1 });
    await dueno.enviar('/clientes/ventas/' + venta + '/anular', { motivo: 'se canceló el pedido' });
    assert.equal(await dueno.aviso('/clientes/ventas/' + venta),
      'Se anuló la venta N° ' + venta + '. Sus tachos volvieron al stock de Entre Ríos. Se habían cobrado $38.000: esa plata se devuelve por fuera del sistema.');
    assert.deepEqual(await estadoTachos(), { ENTREGADO_MAYORISTA: 2, LLENO: 2 });
  });

  test('en el historial, la venta mayorista lleva a su pantalla', async () => {
    const r = await dueno.abrir('/historial/' + venta);
    assert.equal(r.estado, 302);
    assert.equal(r.destino, '/clientes/ventas/' + venta);
  });
});
