'use strict';

// Listas de precios mayoristas (2026-10-22): cambiar y borrar precios, el
// envase, crear una lista copiando otra y elegir la lista de cada cliente.
// Usa sabores que no usa ninguna otra prueba (Bombón Rocher y Kokicukis en
// la Lista Terminal) y deja el envase como estaba.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, erroresDe, consultar, idSabor, idSucursal } = require('./ayudantes');

let sistema;
let dueno;
let empleado;
let terminal; // id de la Lista Terminal
let rocher;
let kokicukis;

async function vigente(idLista, idSabor) {
  const { rows } = await consultar(
    'SELECT precio FROM precios_lista_mayorista WHERE id_lista_precios = $1 AND id_sabor = $2 AND fecha_vigencia_hasta IS NULL',
    [idLista, idSabor]
  );
  return rows[0] ? Number(rows[0].precio) : null;
}

const cuantos = async (idLista) => Number((await consultar(
  'SELECT count(*) FROM precios_lista_mayorista WHERE id_lista_precios = $1 AND fecha_vigencia_hasta IS NULL', [idLista]
)).rows[0].count);

before(async () => {
  sistema = await levantar();
  dueno = new Navegador(sistema.base);
  await dueno.entrar('dueno');
  await dueno.enviar('/sucursal', { id_sucursal: await idSucursal('Entre Ríos') });
  empleado = new Navegador(sistema.base);
  await empleado.entrar('empleado');
  ({ rows: [{ id_lista_precios: terminal }] } = await consultar("SELECT id_lista_precios FROM listas_precios_mayoristas WHERE nombre = 'Lista Terminal'"));
  rocher = await idSabor('Bombón Rocher', 'FAMILIAR');
  kokicukis = await idSabor('Kokicukis', 'FAMILIAR');
});
after(async () => {
  await dueno.enviar('/clientes/listas/envase', { precio: '$5.000' });
  await sistema.apagar();
});

describe('Listas de precios', () => {
  test('el empleado no entra', async () => {
    assert.equal((await empleado.abrir('/clientes/listas')).estado, 403);
    assert.equal((await empleado.abrir('/clientes/listas/' + terminal)).estado, 403);
  });

  test('se ven las listas con sus líneas', async () => {
    const { html } = await dueno.abrir('/clientes/listas');
    assert.match(html, />Lista general<\/a>[\s\S]*?<td>Familiar y artesanal<\/td>/);
    assert.match(html, />Lista Terminal<\/a>\s*<\/td>\s*<td>Solo familiar<\/td>/);
  });

  test('un precio nuevo cierra el anterior y rige desde hoy', async () => {
    await dueno.enviar('/clientes/listas/' + terminal + '/precios', { ['precio_' + rocher]: '$85.000' });
    assert.equal(await dueno.aviso('/clientes/listas/' + terminal), 'Se guardó 1 cambio en la Lista Terminal. Rige desde hoy.');
    assert.equal(await vigente(terminal, rocher), 85000);
    const { rows } = await consultar(
      'SELECT precio, fecha_vigencia_hasta FROM precios_lista_mayorista WHERE id_lista_precios = $1 AND id_sabor = $2 ORDER BY id_precio_lista',
      [terminal, rocher]
    );
    assert.deepEqual(rows.map((r) => [Number(r.precio), r.fecha_vigencia_hasta !== null]), [[80000, true], [85000, false]]);
  });

  test('un campo que no vino no borra nada', async () => {
    const antes = await cuantos(terminal);
    await dueno.enviar('/clientes/listas/' + terminal + '/precios', { ['precio_' + rocher]: '$85.000' });
    assert.equal(await dueno.aviso('/clientes/listas/' + terminal), 'No había ningún precio para cambiar.');
    assert.equal(await cuantos(terminal), antes);
  });

  test('borrar un precio deja al sabor sin precio en la lista', async () => {
    await dueno.enviar('/clientes/listas/' + terminal + '/precios', { ['precio_' + kokicukis]: '' });
    assert.equal(await dueno.aviso('/clientes/listas/' + terminal),
      'Se guardó 1 cambio en la Lista Terminal. Rige desde hoy. Un sabor quedó sin precio.');
    assert.equal(await vigente(terminal, kokicukis), null);
  });

  test('un precio que no se entiende no guarda nada', async () => {
    const r = await dueno.enviar('/clientes/listas/' + terminal + '/precios', { ['precio_' + rocher]: '90.000,5.5' });
    assert.equal(r.estado, 400);
    assert.match(erroresDe(r.html)[0], /^El precio de Bombón Rocher \(familiar\): escribilo como/);
    assert.equal(await vigente(terminal, rocher), 85000);
  });

  test('a Terminal no se le saca la línea familiar mientras tenga precios', async () => {
    const r = await dueno.enviar('/clientes/listas/' + terminal, { nombre: 'Lista Terminal', incluye_artesanal: '1' });
    assert.equal(r.estado, 400);
    assert.match(erroresDe(r.html)[0], /^La Lista Terminal tiene \d+ precios de sabores familiares: borralos antes de sacarle esa línea\.$/);
  });
});

describe('Precio del envase', () => {
  test('se cambia, y no se puede dejar vacío', async () => {
    const vacio = await dueno.enviar('/clientes/listas/envase', { precio: '' });
    assert.equal(vacio.estado, 400);
    await dueno.enviar('/clientes/listas/envase', { precio: '$6.000' });
    assert.equal(await dueno.aviso('/clientes/listas'), 'Se guardó el precio nuevo del envase. Rige desde hoy.');
    const { rows } = await consultar('SELECT precio FROM precios_envase_mayorista WHERE fecha_vigencia_hasta IS NULL');
    assert.equal(Number(rows[0].precio), 6000);
  });
});

describe('Una lista nueva', () => {
  let nueva;

  test('arranca con los precios de la que se elige', async () => {
    const r = await dueno.enviar('/clientes/listas', { nombre: 'Lista Kiosco Norte', incluye_familiar: '1', copiar_de: String(terminal) });
    nueva = Number(/^\/clientes\/listas\/(\d+)$/.exec(r.destino)[1]);
    assert.equal(await dueno.aviso('/clientes/listas/' + nueva),
      'Se creó la Lista Kiosco Norte, con los precios de la Lista Terminal. Cambiá los que sean distintos.');
    assert.equal(await cuantos(nueva), await cuantos(terminal));
    assert.equal(await vigente(nueva, rocher), 85000);
  });

  test('no puede repetir el nombre de otra ni quedarse sin líneas', async () => {
    const r = await dueno.enviar('/clientes/listas', { nombre: 'lista kiosco norte' });
    assert.deepEqual(erroresDe(r.html), ['Ya hay una lista que se llama lista kiosco norte.', 'Elegí al menos una línea.']);
  });

  test('se renombra', async () => {
    await dueno.enviar('/clientes/listas/' + nueva, { nombre: 'Lista Kiosco Sur', incluye_familiar: '1' });
    assert.equal(await dueno.aviso('/clientes/listas/' + nueva), 'Se guardaron los cambios de la Lista Kiosco Sur.');
  });

  test('se le asigna a un cliente, y la Lista general queda como vacío', async () => {
    const cliente = { nombre_razon_social: 'Kiosco Sur', id_lista_precios: String(nueva), limite_cuenta_corriente: '', plazo_pago_dias: '' };
    await dueno.enviar('/clientes', cliente);
    const { rows: [c] } = await consultar("SELECT id_cliente, id_lista_precios FROM clientes WHERE nombre_razon_social = 'Kiosco Sur'");
    assert.equal(c.id_lista_precios, nueva);
    assert.match((await dueno.abrir('/cotizar/' + c.id_cliente)).html, /Cotiza con la <strong>Lista Kiosco Sur<\/strong>/);

    await dueno.enviar('/clientes/' + c.id_cliente, { ...cliente, id_lista_precios: '' });
    const { rows: [despues] } = await consultar('SELECT id_lista_precios FROM clientes WHERE id_cliente = $1', [c.id_cliente]);
    assert.equal(despues.id_lista_precios, null);
  });
});
