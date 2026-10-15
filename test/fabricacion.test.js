'use strict';

// Fabricacion: producir helado en tachos y productos propios, solo en la
// sucursal con fabrica, y cambiar el tacho del pozo. Usa Pistacho y el
// Palito frutal limon, que no usa ninguna otra prueba.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, erroresDe, consultar, idProducto, idSabor, idSucursal, producir } = require('./ayudantes');

let sistema;
let empleado; // Entre Rios, con fabrica
let alem; // Alem, sin fabrica
let sucursal;
let pistacho;
let palito;

// AAAA-MM-DD de hoy mas n dias, en hora local (la de Tucuman en las pruebas).
function dia(n = 0) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function tachos(idSucursal) {
  const { rows } = await consultar(
    `SELECT t.estado, count(*)::int AS n FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote
      WHERE l.id_sabor = $1 AND t.id_sucursal = $2 GROUP BY t.estado`,
    [pistacho, idSucursal]
  );
  return Object.fromEntries(rows.map((r) => [r.estado, r.n]));
}

before(async () => {
  sistema = await levantar();
  empleado = new Navegador(sistema.base);
  await empleado.entrar('empleado');
  alem = new Navegador(sistema.base);
  await alem.entrar('empleadoAlem');
  sucursal = Number(/name="id_sucursal" value="(\d+)"/.exec((await empleado.abrir('/fabricacion')).html)[1]);
  pistacho = await idSabor('Pistacho', 'ARTESANAL');
  palito = await idProducto('Palito frutal limón');
});
after(() => sistema.apagar());

describe('Producir', () => {
  test('en la sucursal sin fábrica no se produce', async () => {
    // Sin fabrica la pantalla ni muestra el formulario; se manda igual.
    assert.doesNotMatch((await alem.abrir('/fabricacion')).html, /action="\/fabricacion\/produccion"/);
    const idAlem = await idSucursal('Alem');
    await alem.enviar('/fabricacion/produccion', { id_sucursal: idAlem, fecha: dia(), que: 'sabor:' + pistacho, cantidad: '1' });
    assert.equal(await alem.aviso('/fabricacion'), 'La producción se registra en la sucursal donde está la fábrica.');
  });

  test('pide qué, cuánto y una fecha que no sea futura', async () => {
    const r = await empleado.enviar('/fabricacion/produccion', { id_sucursal: sucursal, fecha: dia(1), que: '', cantidad: '0' });
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), [
      'Elegí qué se produjo.',
      'Poné cuánto se produjo: un número entero, de 1 a 999.',
      'La producción no puede tener una fecha que todavía no llegó.',
    ]);
  });

  test('el helado se carga en tachos llenos de 10 litros, que vencen a los 6 meses', async () => {
    await producir(empleado, sucursal, 'sabor:' + pistacho, 3, dia(-1));
    assert.equal(await empleado.aviso('/fabricacion'),
      'Se registraron 3 tachos de Pistacho (artesanal). Todavía no tiene receta, así que no se descontaron insumos.');
    assert.deepEqual(await tachos(sucursal), { LLENO: 3 });
    const { rows } = await consultar(
      `SELECT l.fecha_elaboracion::text AS elaborado, l.fecha_vencimiento::text AS vence,
              (SELECT sum(capacidad_litros) FROM tachos t WHERE t.id_lote = l.id_lote)::int AS litros
         FROM lotes l WHERE l.id_sabor = $1`,
      [pistacho]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].elaborado, dia(-1));
    const vence = new Date(dia(-1) + 'T12:00:00');
    vence.setMonth(vence.getMonth() + 6);
    assert.equal(rows[0].vence, vence.toISOString().slice(0, 10));
    assert.equal(rows[0].litros, 30);
  });

  test('un producto propio suma a su stock', async () => {
    await producir(empleado, sucursal, 'producto:' + palito, 20);
    assert.match(await empleado.aviso('/fabricacion'), /^Se registraron 20 \w+ de Palito frutal limón\./);
    const { rows } = await consultar(
      'SELECT coalesce(sum(cantidad), 0)::int AS stock FROM movimientos_producto WHERE id_producto = $1 AND id_sucursal = $2',
      [palito, sucursal]
    );
    assert.equal(rows[0].stock, 20);
  });
});

describe('Cambiar tacho', () => {
  const cambiar = async () => {
    await empleado.enviar('/fabricacion/cambiar-tacho', { id_sucursal: sucursal, id_sabor: pistacho });
    return empleado.aviso('/fabricacion');
  };

  test('el primero abre un tacho lleno', async () => {
    assert.equal(await cambiar(), 'Se abrió el primer tacho de Pistacho (artesanal). Quedan 2 llenos.');
    assert.deepEqual(await tachos(sucursal), { EN_POZO: 1, LLENO: 2 });
  });

  test('después, vacía el del pozo y abre el siguiente', async () => {
    assert.equal(await cambiar(), 'Se terminó un tacho de Pistacho (artesanal) y se abrió el siguiente. Queda 1 lleno.');
    assert.equal(await cambiar(), 'Se terminó un tacho de Pistacho (artesanal) y se abrió el siguiente. Quedan 0 llenos.');
    assert.deepEqual(await tachos(sucursal), { EN_POZO: 1, VACIO: 2 });
  });

  test('cuando no quedan llenos, avisa', async () => {
    assert.equal(await cambiar(), 'Se terminó el tacho de Pistacho (artesanal). No quedan tachos llenos de este sabor en Entre Ríos.');
    assert.equal(await cambiar(), 'No hay tachos de ese sabor en Entre Ríos.');
    assert.deepEqual(await tachos(sucursal), { VACIO: 3 });
  });
});
