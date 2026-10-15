'use strict';

// Llego mercaderia: lo que trae un proveedor suma al stock de la sucursal.
// Usa el Alfajor grande y los Higos, que no usa ninguna otra prueba.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, erroresDe, consultar, idProducto, idInsumo } = require('./ayudantes');

let sistema;
let nav;
let sucursal;
let alfajor; // se cuenta por unidad
let higos; // se pesa, en kg
let proveedor;

const registrar = (campos) => nav.enviar('/mercaderia', { id_sucursal: sucursal, ...campos });
// Los renglones van como listas paralelas, igual que en el formulario.
const renglones = (...pares) => pares.flatMap(([item, cantidad]) => [['renglon_item', item], ['renglon_cantidad', cantidad]]);

before(async () => {
  sistema = await levantar();
  nav = new Navegador(sistema.base);
  await nav.entrar('empleado');
  sucursal = /name="id_sucursal" value="(\d+)"/.exec((await nav.abrir('/mercaderia')).html)[1];
  alfajor = 'producto:' + await idProducto('Alfajor grande');
  higos = 'insumo:' + await idInsumo('Higos');
  const { rows } = await consultar("INSERT INTO proveedores (razon_social) VALUES ('Proveedor de prueba') RETURNING id_proveedor");
  proveedor = rows[0].id_proveedor;
});
after(() => sistema.apagar());

// Con listas paralelas, los campos van como pares para que se repitan.
const enviarPares = (pares) => nav.enviar('/mercaderia', [['id_sucursal', sucursal], ...pares]);

describe('Llegó mercadería', () => {
  test('sin nada en la lista no registra', async () => {
    const r = await registrar({});
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['Agregá lo que llegó.']);
  });

  test('lo que se cuenta va en enteros, y lo que se pesa admite decimales', async () => {
    const r = await enviarPares(renglones([alfajor, '2,5'], [higos, 'mucho']));
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), [
      'La cantidad de "Alfajor grande" es un número entero (un).',
      'La cantidad de "Higos" va en kg, con coma para los decimales (por ejemplo: 2,5).',
    ]);
  });

  test('no deja el mismo producto dos veces', async () => {
    const r = await enviarPares(renglones([alfajor, '10'], [alfajor, '5']));
    assert.deepEqual(erroresDe(r.html), ['"Alfajor grande" está dos veces en la lista: dejalo una sola vez con el total.']);
  });

  test('registra lo que llegó, con proveedor y remito, y suma al stock', async () => {
    const r = await enviarPares([...renglones([alfajor, '24'], [higos, '2,5']),
      ['id_proveedor', String(proveedor)], ['numero_remito', 'R-0001']]);
    assert.equal(r.estado, 302);
    assert.equal(await nav.aviso('/mercaderia'), 'Se registró lo que llegó (2 cosas). Ya suma al stock de Entre Ríos.');

    const { rows: [stock] } = await consultar(
      `SELECT (SELECT sum(cantidad) FROM movimientos_producto m JOIN productos p USING (id_producto)
                WHERE p.nombre = 'Alfajor grande' AND m.id_sucursal = $1)::numeric AS alfajores,
              (SELECT sum(cantidad) FROM movimientos_insumo m JOIN insumos i USING (id_insumo)
                WHERE i.nombre = 'Higos' AND m.id_sucursal = $1)::numeric AS higos`,
      [sucursal]
    );
    assert.equal(Number(stock.alfajores), 24);
    assert.equal(Number(stock.higos), 2.5);

    const { html } = await nav.abrir('/mercaderia');
    assert.match(html, /Proveedor de prueba/);
    assert.match(html, /Alfajor grande: 24 un/);
    assert.match(html, /Higos: 2,5 kg/);
  });

  test('un proveedor que no existe no se acepta', async () => {
    const r = await enviarPares([...renglones([alfajor, '1']), ['id_proveedor', '999999']]);
    assert.deepEqual(erroresDe(r.html), ['Elegí un proveedor de la lista o dejalo sin elegir.']);
  });
});
