'use strict';

// La carta de PedidosYa: cobra su propio precio, el canal va fijo, no se
// mezcla con Vender, y los duenos la arman con productos que ya existen.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, erroresDe, consultar, idProducto, idMedio, idCategoria, cajaNueva } = require('./ayudantes');

let sistema;
let empleado;
let sucursal;
let familiar;
let cono;
let transferencia;

before(async () => {
  sistema = await levantar();
  empleado = new Navegador(sistema.base);
  await empleado.entrar('empleado');
  sucursal = await cajaNueva(empleado);
  familiar = await idProducto('Familiar 3 lt chocolate, vainilla y dulce de leche');
  cono = await idProducto('Cono simple');
  transferencia = await idMedio('Transferencia o QR');
});
after(() => sistema.apagar());

const sumar = (nav, carta, producto) =>
  nav.enviar('/' + carta + '/pedido', { id_sucursal: sucursal, id_producto: producto, accion: 'agregar' });

// El panel del pedido, como lo pide la pagina al tocar un producto.
async function panel(nav, carta, producto) {
  const r = await fetch(sistema.base + '/' + carta + '/pedido', {
    method: 'POST',
    headers: { cookie: nav.cookie, 'content-type': 'application/x-www-form-urlencoded', 'X-Kokino-Parcial': 'pedido' },
    body: new URLSearchParams({ id_sucursal: sucursal, id_producto: producto, accion: 'agregar' }),
  });
  return (await r.json()).html;
}

describe('Vender por PedidosYa', () => {
  test('el mismo producto cobra su precio en cada carta', async () => {
    const enPedidosYa = await panel(empleado, 'pedidosya', familiar);
    const enMostrador = await panel(empleado, 'ventas', familiar);
    assert.match(enPedidosYa, /Cobrar \$39\.000/);
    assert.match(enMostrador, /Cobrar \$36\.000/);
  });

  test('cada carta arma su propio pedido', async () => {
    // Cada una tiene un familiar: el que se sumo en la prueba anterior.
    const enPedidosYa = await panel(empleado, 'pedidosya', familiar);
    assert.match(enPedidosYa, /Cobrar \$78\.000/);
    await empleado.enviar('/ventas/pedido', { id_sucursal: sucursal, accion: 'vaciar' });
    await empleado.enviar('/pedidosya/pedido', { id_sucursal: sucursal, accion: 'vaciar' });
  });

  test('un producto que no está en la carta no se puede sumar', async () => {
    await sumar(empleado, 'pedidosya', cono);
    const { html } = await empleado.abrir('/pedidosya');
    assert.match(html, /Tocá un producto para sumarlo al pedido/);
  });

  test('no pregunta el canal, y la venta queda como PedidosYa', async () => {
    const enPanel = await panel(empleado, 'pedidosya', familiar);
    assert.doesNotMatch(enPanel, /Por dónde fue la venta/);
    const r = await empleado.enviar('/pedidosya/cobrar', { id_sucursal: sucursal, id_medio_pago: transferencia, canal: 'MOSTRADOR' });
    assert.equal(r.estado, 302);
    assert.equal(await empleado.aviso('/pedidosya'), 'Venta registrada: $39.000.');
    const { rows } = await consultar(
      `SELECT v.canal_venta, d.precio_unitario_aplicado AS precio
         FROM ventas v JOIN venta_detalle d ON d.id_venta = v.id_venta
        ORDER BY v.id_venta DESC LIMIT 1`
    );
    assert.equal(rows[0].canal_venta, 'PEDIDOSYA');
    assert.equal(Number(rows[0].precio), 39000);
  });

  test('"PedidosYa (online)" se ofrece solo en PedidosYa', async () => {
    const enPedidosYa = await panel(empleado, 'pedidosya', familiar);
    const enMostrador = await panel(empleado, 'ventas', familiar);
    assert.match(enPedidosYa, /PedidosYa \(online\)/);
    assert.doesNotMatch(enMostrador, /PedidosYa \(online\)/);
  });

  test('forzar "PedidosYa (online)" en Vender no cobra', async () => {
    const online = await idMedio('PedidosYa (online)');
    const r = await empleado.enviar('/ventas/cobrar', { id_sucursal: sucursal, canal: 'MOSTRADOR', id_medio_pago: online });
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['Elegí con qué pagó.']);
    await empleado.enviar('/ventas/pedido', { id_sucursal: sucursal, accion: 'vaciar' });
  });

  test('un pedido pagado en la app se cobra con "PedidosYa (online)"', async () => {
    const online = await idMedio('PedidosYa (online)');
    const r = await empleado.enviar('/pedidosya/cobrar', { id_sucursal: sucursal, id_medio_pago: online });
    assert.equal(r.estado, 302);
    assert.equal(await empleado.aviso('/pedidosya'), 'Venta registrada: $39.000.');
  });

  test('una salida de caja no se paga con "PedidosYa (online)"', async () => {
    const r = await empleado.enviar('/caja/egresos', {
      id_sucursal: sucursal, tipo_egreso: 'COMPRA', monto: '$100',
      id_medio_pago: await idMedio('PedidosYa (online)'), descripcion: 'prueba',
    });
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['Elegí con qué se pagó.']);
  });

  test('una venta de PedidosYa no se anula desde Vender', async () => {
    const { rows } = await consultar("SELECT max(id_venta) AS id FROM ventas WHERE canal_venta = 'PEDIDOSYA'");
    await empleado.enviar('/ventas/' + rows[0].id + '/anular', { motivo: 'prueba' });
    assert.equal(await empleado.aviso('/ventas'), 'No encontramos esa venta entre las de tu sucursal.');
  });
});

// La tarjeta de una categoria en el inicio de PedidosYa.
const enlaceA = (idCategoria) => new RegExp('href="/pedidosya\\?categoria=' + idCategoria + '"');

describe('Armar la carta (dueños)', () => {
  let dueno;
  let cafe;
  let cafeteria;
  before(async () => {
    dueno = new Navegador(sistema.base);
    await dueno.entrar('dueno');
    // El dueno elige sucursal; trabaja en la del empleado, que tiene la caja
    // abierta (sin caja, PedidosYa no muestra la carta).
    await dueno.enviar('/sucursal', { id_sucursal: sucursal });
    cafe = await idProducto('Café chico');
    cafeteria = await idCategoria('Cafetería');
  });

  test('solo se ven las categorías con algo en la carta', async () => {
    const { html } = await dueno.abrir('/pedidosya');
    assert.match(html, enlaceA(await idCategoria('Familiar')));
    assert.doesNotMatch(html, enlaceA(cafeteria));
    assert.match(html, /Sumar a PedidosYa/);
  });

  test('sumar exige elegir producto y un precio bien escrito', async () => {
    const r = await dueno.enviar('/pedidosya/agregar', { id_producto: '', precio: 'mucho' });
    assert.equal(r.estado, 400);
    assert.equal(erroresDe(r.html).length, 2);
  });

  test('suma un producto que ya existe, y aparece su categoría', async () => {
    const r = await dueno.enviar('/pedidosya/agregar', { id_producto: cafe, precio: '$2.800' });
    assert.equal(r.destino, '/pedidosya?categoria=' + cafeteria);
    assert.equal(await dueno.aviso('/pedidosya'), 'Se sumó Café chico a PedidosYa a $2.800.');
    const { html } = await dueno.abrir('/pedidosya?categoria=' + cafeteria);
    assert.match(html, /Café chico[\s\S]*?\$2\.800/);
  });

  test('no se suma dos veces', async () => {
    const r = await dueno.enviar('/pedidosya/agregar', { id_producto: cafe, precio: '$3.000' });
    assert.deepEqual(erroresDe(r.html), ['Café chico ya está en PedidosYa: su precio se cambia desde Editar precios.']);
  });

  test('cambiar el precio no pisa el anterior: lo cierra y abre otro', async () => {
    await dueno.enviar('/pedidosya/categorias/' + cafeteria + '/editar', { id_producto: cafe, precio: '$3.000' });
    const { rows } = await consultar(
      `SELECT precio, fecha_vigencia_hasta IS NULL AS vigente FROM precios
        WHERE id_producto = $1 AND tipo_precio = 'PEDIDOSYA' ORDER BY id_precio`,
      [cafe]
    );
    assert.deepEqual(rows.map((p) => [Number(p.precio), p.vigente]), [[2800, false], [3000, true]]);
  });

  test('el precio de mostrador no cambia', async () => {
    const { rows } = await consultar(
      "SELECT precio FROM precios WHERE id_producto = $1 AND tipo_precio = 'MINORISTA' AND fecha_vigencia_hasta IS NULL",
      [cafe]
    );
    assert.equal(Number(rows[0].precio), 2500);
  });

  test('al sacar el último de una categoría, la categoría desaparece', async () => {
    const r = await dueno.enviar('/pedidosya/categorias/' + cafeteria + '/editar', { sacar: cafe });
    assert.equal(r.destino, '/pedidosya');
    const { html } = await dueno.abrir('/pedidosya');
    assert.doesNotMatch(html, enlaceA(cafeteria));
  });
});
