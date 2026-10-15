'use strict';

// Cobrar en Vender y anular: lo que pasa todos los dias en el mostrador.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, erroresDe, consultar, idProducto, idMedio, cajaNueva } = require('./ayudantes');

let sistema;
let nav;
let sucursal;
let cono; // $4.500
let termico; // $15.000
let efectivo;
let debito;
let transferencia;

before(async () => {
  sistema = await levantar();
  nav = new Navegador(sistema.base);
  await nav.entrar('empleado');
  sucursal = await cajaNueva(nav);
  cono = await idProducto('Cono simple');
  termico = await idProducto('Térmico 1/2 kg');
  efectivo = await idMedio('Efectivo');
  debito = await idMedio('Débito');
  transferencia = await idMedio('Transferencia o QR');
});
after(() => sistema.apagar());

const sumar = (producto, cantidad = 1) =>
  nav.enviar('/ventas/pedido', { id_sucursal: sucursal, id_producto: producto, accion: 'agregar', cantidad });
const vaciar = () => nav.enviar('/ventas/pedido', { id_sucursal: sucursal, accion: 'vaciar' });
const cobrar = (campos) => nav.enviar('/ventas/cobrar', { id_sucursal: sucursal, ...campos });

async function ultimaVenta() {
  const { rows } = await consultar(
    `SELECT v.id_venta, v.canal_venta, vt.total, v.fecha_anulacion
       FROM ventas v JOIN ventas_totales vt ON vt.id_venta = v.id_venta
      ORDER BY v.id_venta DESC LIMIT 1`
  );
  return rows[0];
}

describe('Cobrar', () => {
  test('con el pedido vacío no cobra', async () => {
    await vaciar();
    const r = await cobrar({ canal: 'MOSTRADOR', id_medio_pago: debito });
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['El pedido está vacío: agregá al menos un producto.']);
  });

  test('en efectivo en el mostrador, exige con cuánto paga', async () => {
    await sumar(cono, 2);
    const r = await cobrar({ canal: 'MOSTRADOR', id_medio_pago: efectivo });
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['Poné con cuánto paga el cliente.']);
  });

  test('si la plata no alcanza, dice cuánto falta', async () => {
    const r = await cobrar({ canal: 'MOSTRADOR', id_medio_pago: efectivo, paga_con: '$5.000' });
    assert.deepEqual(erroresDe(r.html), ['Paga con $5.000 y la venta es de $9.000: faltan $4.000.']);
  });

  test('cobra y dice el vuelto', async () => {
    const r = await cobrar({ canal: 'MOSTRADOR', id_medio_pago: efectivo, paga_con: '$10.000' });
    assert.equal(r.estado, 302);
    assert.equal(await nav.aviso('/ventas'), 'Venta registrada: $9.000. Vuelto: $1.000.');
    const venta = await ultimaVenta();
    assert.equal(venta.canal_venta, 'MOSTRADOR');
    assert.equal(Number(venta.total), 9000);
  });

  test('después de cobrar, el pedido queda vacío', async () => {
    const { html } = await nav.abrir('/ventas');
    assert.match(html, /Tocá un producto para sumarlo al pedido/);
  });

  test('por teléfono no hace falta decir con cuánto paga', async () => {
    await sumar(termico);
    const r = await cobrar({ canal: 'TELEFONO', id_medio_pago: debito });
    assert.equal(r.estado, 302);
    assert.equal(await nav.aviso('/ventas'), 'Venta registrada: $15.000.');
  });

  test('con varios medios, los montos tienen que sumar el total', async () => {
    await sumar(termico);
    await sumar(cono);
    const mal = await cobrar({ canal: 'MOSTRADOR', id_medio_pago: 'varios', ['monto_' + efectivo]: '$10.000', ['monto_' + transferencia]: '$5.000' });
    assert.deepEqual(erroresDe(mal.html), ['Los montos suman $15.000 y la venta es de $19.500: faltan $4.500.']);
    const bien = await cobrar({ canal: 'MOSTRADOR', id_medio_pago: 'varios', ['monto_' + efectivo]: '$10.000', ['monto_' + transferencia]: '$9.500' });
    assert.equal(bien.estado, 302);
    assert.equal(await nav.aviso('/ventas'), 'Venta registrada: $19.500 (Efectivo $10.000, Transferencia o QR $9.500).');
  });

  test('desde Vender no se puede cobrar como PedidosYa', async () => {
    await sumar(cono);
    const r = await cobrar({ canal: 'PEDIDOSYA', id_medio_pago: debito });
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['Elegí por dónde fue la venta.']);
    await vaciar();
  });

  test('el precio sale de la base, no de lo que manda la página', async () => {
    await sumar(cono);
    // Un precio inventado en el formulario no tiene ningun efecto.
    await cobrar({ canal: 'TELEFONO', id_medio_pago: debito, precio: '1', total: '1' });
    assert.equal(Number((await ultimaVenta()).total), 4500);
  });
});

describe('Anular', () => {
  let idVenta;
  before(async () => {
    await sumar(cono, 2);
    await cobrar({ canal: 'MOSTRADOR', id_medio_pago: efectivo, paga_con: '$9.000' });
    idVenta = (await ultimaVenta()).id_venta;
  });

  test('pide el motivo', async () => {
    const r = await nav.enviar('/ventas/' + idVenta + '/anular', { motivo: '' });
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['Escribí por qué se anula la venta.']);
  });

  test('anula y dice cuánto efectivo devolver', async () => {
    const r = await nav.enviar('/ventas/' + idVenta + '/anular', { motivo: 'Se cargaron 2 conos y era 1' });
    assert.equal(r.estado, 302);
    assert.equal(await nav.aviso('/ventas'), 'Venta anulada. Devolvele al cliente $9.000 en efectivo.');
    assert.ok((await ultimaVenta()).fecha_anulacion);
  });

  test('devuelve el stock que había descontado', async () => {
    // Los dos movimientos tienen que existir: si solo se mirara que la suma
    // da cero, la prueba pasaria tambien si la venta nunca hubiera
    // descontado nada.
    const { rows } = await consultar(
      `SELECT m.tipo_movimiento, m.cantidad::numeric AS cantidad
         FROM movimientos_insumo m JOIN insumos i ON i.id_insumo = m.id_insumo
        WHERE i.nombre = 'Cucurucho simple' AND m.id_venta = $1
        ORDER BY m.tipo_movimiento`,
      [idVenta]
    );
    assert.deepEqual(rows.map((m) => [m.tipo_movimiento, Number(m.cantidad)]), [
      ['ANULACION_VENTA', 2],
      ['CONSUMO_VENTA', -2],
    ]);
  });

  test('no se anula dos veces', async () => {
    await nav.enviar('/ventas/' + idVenta + '/anular', { motivo: 'otra vez' });
    assert.equal(await nav.aviso('/ventas'), 'Esa venta ya estaba anulada.');
  });

  test('una venta de una caja ya cerrada no se anula', async () => {
    await sumar(cono);
    await cobrar({ canal: 'TELEFONO', id_medio_pago: debito });
    const vieja = (await ultimaVenta()).id_venta;
    await nav.enviar('/caja/cerrar', { id_sucursal: sucursal, monto_cierre_declarado: '$0' });
    await nav.enviar('/ventas/' + vieja + '/anular', { motivo: 'reclamo' });
    assert.match(await nav.aviso('/ventas'), /La caja de esa venta ya se cerró/);
    assert.equal((await ultimaVenta()).fecha_anulacion, null);
  });
});
