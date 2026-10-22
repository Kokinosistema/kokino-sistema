'use strict';

// Cotizar a un mayorista (traido del Sistema Rody el 2026-10-22): la lista de
// precios de cada cliente, lo que frena "Se lo lleva" y lo que se guarda al
// confirmar. Usa el Chocolate familiar, que no usa ninguna otra prueba, y los
// precios reales del Excel (seed:precios-mayoristas).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, erroresDe, consultar, idMedio, idSabor, idSucursal, producir } = require('./ayudantes');

let sistema;
let dueno;
let empleado;
let er;
let chocolate;
let menta;
let terminal; // cotiza con la Lista Terminal y tiene cuenta corriente
let general;  // cotiza con la Lista general y paga en el momento

// "Se lo lleva" con los renglones como listas paralelas, igual que el formulario.
function seLoLleva(cliente, renglones, envases = {}) {
  const pares = [['id_sucursal', String(er)]];
  for (const r of renglones) pares.push(['renglon_sabor', String(r.sabor)], ['renglon_tachos', String(r.tachos)], ['renglon_precio', r.precio || '']);
  for (const [k, v] of Object.entries(envases)) pares.push([k, String(v)]);
  return dueno.enviar('/cotizar/' + cliente, pares);
}

async function estadoChocolate() {
  const { rows } = await consultar(
    `SELECT t.estado, count(*)::int AS n FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote
      WHERE l.id_sabor = $1 GROUP BY t.estado ORDER BY 1`,
    [chocolate]
  );
  return Object.fromEntries(rows.map((r) => [r.estado, r.n]));
}

before(async () => {
  sistema = await levantar();
  dueno = new Navegador(sistema.base);
  await dueno.entrar('dueno');
  empleado = new Navegador(sistema.base);
  await empleado.entrar('empleado');
  er = await idSucursal('Entre Ríos');
  await dueno.enviar('/sucursal', { id_sucursal: er });
  chocolate = await idSabor('Chocolate', 'FAMILIAR');
  menta = await idSabor('Menta granizada', 'FAMILIAR');
  await producir(dueno, er, 'sabor:' + chocolate, 3);
  const { rows } = await consultar(
    `INSERT INTO clientes (nombre_razon_social, tipo_cliente, limite_cuenta_corriente, plazo_pago_dias, id_lista_precios)
     VALUES ('Terminal de prueba', 'MAYORISTA', 1000000, 30, (SELECT id_lista_precios FROM listas_precios_mayoristas WHERE nombre = 'Lista Terminal')),
            ('Kiosco de la general', 'MAYORISTA', NULL, NULL, NULL)
     RETURNING id_cliente`
  );
  [terminal, general] = rows.map((r) => r.id_cliente);
});
after(() => sistema.apagar());

describe('Armar la cotización', () => {
  test('el empleado no entra', async () => {
    assert.equal((await empleado.abrir('/cotizar')).estado, 403);
    assert.equal((await empleado.abrir('/cotizar/' + terminal)).estado, 403);
  });

  test('al elegir el cliente se ve con qué lista cotiza', async () => {
    const { html } = await dueno.abrir('/cotizar');
    assert.match(html, /Terminal de prueba<\/a><\/td>\s*<td>Lista Terminal<\/td>/);
    assert.match(html, /Kiosco de la general<\/a><\/td>\s*<td>Lista general<\/td>/);
  });

  test('cada cliente ve los precios de su lista, y Terminal solo los familiares', async () => {
    const t = (await dueno.abrir('/cotizar/' + terminal)).html;
    assert.match(t, /Chocolate \(familiar\) <span class="combo-extra">\$58\.000 · 3 llenos<\/span>/);
    assert.doesNotMatch(t, /\(artesanal\)/);
    const g = (await dueno.abrir('/cotizar/' + general)).html;
    assert.match(g, /Chocolate \(familiar\) <span class="combo-extra">\$40\.000 · 3 llenos<\/span>/);
    assert.match(g, /Chocolate clásico \(artesanal\) <span class="combo-extra">\$48\.000 · 0 llenos<\/span>/);
    assert.match(g, /Menta granizada \(familiar\) <span class="combo-extra">sin precio · 0 llenos<\/span>/);
  });
});

describe('Lo que frena "Se lo lleva"', () => {
  test('un sabor sin precio en la lista', async () => {
    const r = await seLoLleva(general, [{ sabor: menta, tachos: 1 }], { compra_envases: 'NO' });
    assert.equal(r.estado, 400);
    assert.ok(erroresDe(r.html).includes('Menta granizada (familiar) no tiene precio en la Lista general: sacalo, o cargale el precio en la lista.'));
  });

  test('que no alcancen los tachos llenos', async () => {
    const r = await seLoLleva(terminal, [{ sabor: chocolate, tachos: 5 }], { compra_envases: 'NO' });
    assert.deepEqual(erroresDe(r.html), ['De Chocolate (familiar) hay 3 tachos llenos en Entre Ríos: no alcanzan para 5.']);
  });

  test('no haber respondido si compra los envases, o comprar más que los tachos', async () => {
    const sinResponder = await seLoLleva(terminal, [{ sabor: chocolate, tachos: 2 }]);
    assert.deepEqual(erroresDe(sinResponder.html), ['Respondé si compra los envases.']);
    const demas = await seLoLleva(terminal, [{ sabor: chocolate, tachos: 2 }], { compra_envases: 'SI', envases_comprados: 3 });
    assert.deepEqual(erroresDe(demas.html), ['Poné cuántos envases compra: entre 1 y 2, uno por tacho.']);
  });

  test('un precio que no se entiende', async () => {
    const r = await seLoLleva(terminal, [{ sabor: chocolate, tachos: 1, precio: '4000.50' }], { compra_envases: 'NO' });
    assert.equal(erroresDe(r.html).length, 1);
    assert.match(erroresDe(r.html)[0], /^El precio de Chocolate \(familiar\): escribilo como/);
  });

  test('nada de esto toca el stock', async () => {
    assert.deepEqual(await estadoChocolate(), { LLENO: 3 });
  });
});

describe('Se lo lleva', () => {
  let venta;

  test('Terminal se lleva 2 de chocolate y compra 1 envase: revisa y confirma a cuenta', async () => {
    const r = await seLoLleva(terminal, [{ sabor: chocolate, tachos: 2 }], { compra_envases: 'SI', envases_comprados: 1 });
    assert.equal(r.estado, 302, erroresDe(r.html).join(' '));
    assert.equal(r.destino, '/cotizar/' + terminal + '/revisar');

    const revision = await dueno.abrir(r.destino);
    assert.equal(revision.estado, 200);
    assert.match(revision.html, /<td>Envases comprados<\/td>\s*<td><\/td>\s*<td class="numero">1<\/td>\s*<td class="numero">\$5\.000<\/td>/);
    assert.match(revision.html, /\$121\.000/);

    const sinPago = await dueno.enviar('/cotizar/' + terminal + '/confirmar', {});
    assert.equal(sinPago.estado, 400);
    assert.deepEqual(erroresDe(sinPago.html), ['Elegí si pagó ahora o queda a cuenta.']);

    const confirmado = await dueno.enviar('/cotizar/' + terminal + '/confirmar', { pago: 'CUENTA' });
    venta = Number(/^\/clientes\/ventas\/(\d+)$/.exec(confirmado.destino)[1]);
    assert.equal(await dueno.aviso('/clientes/ventas/' + venta),
      'Se registró la venta N° ' + venta + ' a Terminal de prueba. Imprimí el remito para que viaje con los tachos.');
  });

  test('se guarda el helado al precio de la lista y el envase aparte, y salen los tachos', async () => {
    const { rows } = await consultar(
      'SELECT envase, precio_aplicado, precio_envase FROM venta_tachos WHERE id_venta = $1 ORDER BY envase', [venta]
    );
    assert.deepEqual(rows.map((r) => [r.envase, Number(r.precio_aplicado), Number(r.precio_envase)]),
      [['INCLUIDO', 58000, 5000], ['RETORNABLE', 58000, 0]]);
    const { rows: [t] } = await consultar('SELECT total FROM ventas_totales WHERE id_venta = $1', [venta]);
    assert.equal(Number(t.total), 121000);
    assert.deepEqual(await estadoChocolate(), { ENTREGADO_MAYORISTA: 2, LLENO: 1 });
  });

  test('el remito muestra el envase comprado y el prestado a devolver', async () => {
    const { html } = await dueno.abrir('/clientes/ventas/' + venta);
    assert.match(html, /<td>Envases comprados<\/td>/);
    assert.match(html, /Envases retornables:<\/strong> 1 tacho, a devolver/);
  });

  test('con el precio corregido para la venta, pagando en el momento', async () => {
    const r = await seLoLleva(general, [{ sabor: chocolate, tachos: 1, precio: '$35.000' }], { compra_envases: 'NO' });
    assert.equal(r.estado, 302, erroresDe(r.html).join(' '));
    const efectivo = await idMedio('Efectivo');
    const confirmado = await dueno.enviar('/cotizar/' + general + '/confirmar', { pago: 'AHORA', id_medio_pago: efectivo });
    const id = Number(/^\/clientes\/ventas\/(\d+)$/.exec(confirmado.destino)[1]);
    const { rows: [v] } = await consultar(
      `SELECT vt.total, (SELECT sum(monto) FROM pagos_venta p WHERE p.id_venta = vt.id_venta) AS cobrado
         FROM ventas_totales vt WHERE vt.id_venta = $1`, [id]
    );
    assert.deepEqual([Number(v.total), Number(v.cobrado)], [35000, 35000]);
    assert.deepEqual(await estadoChocolate(), { ENTREGADO_MAYORISTA: 3 });
  });
});
