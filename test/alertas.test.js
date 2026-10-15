'use strict';

// Aviso de stock negativo en el Inicio de los duenos. Usa el Diet de
// chocolate y vainilla, que ninguna otra prueba vende, para poder comparar
// contra un numero exacto.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, idProducto, idMedio, idSucursal, cajaNueva } = require('./ayudantes');

let sistema;
let empleado;
let dueno;
let sucursal;
let diet;
const NOMBRE = 'Diet 250 cc chocolate y vainilla';

// El bloque "Stock en negativo" del Inicio, como texto (null si no esta).
async function negativoEnInicio(nav) {
  const { html } = await nav.abrir('/');
  const bloque = /<h3 class="subtitulo-panel">Stock en negativo<\/h3>([\s\S]*?)<\/div>/.exec(html);
  return bloque ? bloque[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : null;
}

before(async () => {
  sistema = await levantar();
  empleado = new Navegador(sistema.base);
  await empleado.entrar('empleado');
  sucursal = await cajaNueva(empleado);
  diet = await idProducto(NOMBRE);
  // Se venden 2 sin haber cargado nunca stock: queda en -2.
  await empleado.enviar('/ventas/pedido', { id_sucursal: sucursal, id_producto: diet, accion: 'agregar', cantidad: 2 });
  await empleado.enviar('/ventas/cobrar', { id_sucursal: sucursal, canal: 'TELEFONO', id_medio_pago: await idMedio('Débito') });
  dueno = new Navegador(sistema.base);
  await dueno.entrar('dueno');
  await dueno.enviar('/sucursal', { id_sucursal: sucursal });
});
after(() => sistema.apagar());

describe('Stock en negativo', () => {
  test('el dueño lo ve en el Inicio, con su unidad y cómo corregirlo', async () => {
    const texto = await negativoEnInicio(dueno);
    assert.ok(texto, 'no aparece el bloque de stock en negativo');
    assert.match(texto, new RegExp(NOMBRE + ': -2 un'));
    const { html } = await dueno.abrir('/');
    assert.match(html, /href="\/productos\?cargar=1">stock de productos/);
  });

  test('en la otra sucursal no aparece', async () => {
    await dueno.enviar('/sucursal', { id_sucursal: await idSucursal('Alem') });
    const texto = await negativoEnInicio(dueno);
    assert.ok(!texto || !texto.includes(NOMBRE));
    await dueno.enviar('/sucursal', { id_sucursal: sucursal });
  });

  test('el empleado no lo ve', async () => {
    assert.equal(await negativoEnInicio(empleado), null);
  });

  test('al cargar lo contado, el aviso desaparece', async () => {
    const r = await dueno.enviar('/stock/contado/producto', { id_sucursal: sucursal, ['producto_' + diet]: '5' });
    assert.equal(r.estado, 302);
    const texto = await negativoEnInicio(dueno);
    assert.ok(!texto || !texto.includes(NOMBRE), 'sigue apareciendo despues de cargar el stock');
  });
});
