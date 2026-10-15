'use strict';

// Envios de la fabrica (Entre Rios) a Alem: armar, enviar, recibir con
// faltantes y cancelar. Usa Sambayon y el Palito bombon, que no usa ninguna
// otra prueba.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, erroresDe, consultar, idProducto, idSabor, idSucursal, producir } = require('./ayudantes');

let sistema;
let fabrica; // empleado de Entre Rios
let alem; // empleado de Alem
let er;
let idAlem;
let sambayon;
let palito;

async function estadoTachos() {
  const { rows } = await consultar(
    `SELECT s.nombre AS sucursal, t.estado, count(*)::int AS n
       FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote JOIN sucursales s ON s.id_sucursal = t.id_sucursal
      WHERE l.id_sabor = $1 GROUP BY s.nombre, t.estado ORDER BY 1, 2`,
    [sambayon]
  );
  return rows.map((r) => r.sucursal + ' ' + r.estado + ' ' + r.n);
}

async function stockPalito(idSuc) {
  const { rows } = await consultar(
    'SELECT coalesce(sum(cantidad), 0)::int AS n FROM movimientos_producto WHERE id_producto = $1 AND id_sucursal = $2',
    [palito, idSuc]
  );
  return rows[0].n;
}

// Arma, revisa y envia. Devuelve el numero de envio.
async function enviar(campos) {
  const r = await fabrica.enviar('/envios/revisar', { id_sucursal: er, id_destino: idAlem, ...campos });
  assert.equal(r.estado, 302, erroresDe(r.html).join(' '));
  assert.equal((await fabrica.abrir('/envios/revisar')).estado, 200);
  const enviado = await fabrica.enviar('/envios/enviar');
  return Number(/\/envios\/(\d+)$/.exec(enviado.destino)[1]);
}

before(async () => {
  sistema = await levantar();
  fabrica = new Navegador(sistema.base);
  await fabrica.entrar('empleado');
  alem = new Navegador(sistema.base);
  await alem.entrar('empleadoAlem');
  er = await idSucursal('Entre Ríos');
  idAlem = await idSucursal('Alem');
  sambayon = await idSabor('Sambayón', 'ARTESANAL');
  palito = await idProducto('Palito bombón');
  await producir(fabrica, er, 'sabor:' + sambayon, 3);
  await producir(fabrica, er, 'producto:' + palito, 20);
});
after(() => sistema.apagar());

describe('Armar un envío', () => {
  test('desde la sucursal sin fábrica no se arma', async () => {
    await alem.enviar('/envios/revisar', { id_sucursal: idAlem, id_destino: er, ['sabor_' + sambayon]: '1' });
    assert.equal(await alem.aviso('/envios'), 'Los envíos se arman en la sucursal donde está la fábrica.');
  });

  test('pide qué enviar y a dónde', async () => {
    const r = await fabrica.enviar('/envios/revisar', { id_sucursal: er, id_destino: '' });
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['Elegí al menos un tacho o un producto para enviar.', 'Elegí a qué sucursal va el envío.']);
  });

  test('no deja enviar más de lo que hay', async () => {
    const r = await fabrica.enviar('/envios/revisar', { id_sucursal: er, id_destino: idAlem, ['sabor_' + sambayon]: '4', ['producto_' + palito]: '21' });
    assert.deepEqual(erroresDe(r.html), [
      'De Sambayón (artesanal) hay 3 tachos llenos: no se pueden enviar 4.',
      'De Palito bombón hay 20 disponibles: no se pueden enviar 21.',
    ]);
  });
});

describe('Enviar y recibir', () => {
  let numero;
  let tachosDelEnvio;

  test('al enviar, los tachos quedan en camino y el stock todavía no se mueve', async () => {
    numero = await enviar({ ['sabor_' + sambayon]: '2', ['producto_' + palito]: '10' });
    assert.equal(await fabrica.aviso('/envios'), 'El envío N° ' + numero + ' quedó en camino. Imprimí el ticket para que viaje con la mercadería.');
    assert.deepEqual(await estadoTachos(), ['Entre Ríos EN_CAMINO 2', 'Entre Ríos LLENO 1']);
    assert.equal(await stockPalito(er), 20);
    ({ rows: tachosDelEnvio } = await consultar('SELECT id_tacho FROM traslado_tachos WHERE id_traslado = $1 ORDER BY id_tacho', [numero]));
  });

  test('lo que está en camino no se puede volver a enviar', async () => {
    const r = await fabrica.enviar('/envios/revisar', { id_sucursal: er, id_destino: idAlem, ['producto_' + palito]: '11' });
    assert.deepEqual(erroresDe(r.html), ['De Palito bombón hay 10 disponibles: no se pueden enviar 11.']);
  });

  test('se recibe en el destino, no en el origen', async () => {
    await fabrica.abrir('/envios/' + numero + '/recibir');
    assert.equal(await fabrica.aviso('/envios'), 'Ese envío no está para recibir en Entre Ríos.');
    assert.equal((await alem.abrir('/envios/' + numero + '/recibir')).estado, 200);
  });

  test('lo que no llegó necesita motivo, y no puede llegar más de lo enviado', async () => {
    // Se marca solo el primer tacho: el segundo queda sin marcar y sin motivo.
    const t1 = tachosDelEnvio[0].id_tacho;
    const r = await alem.enviar('/envios/' + numero + '/recibir', {
      ['llego_' + t1]: '1', ['recibido_' + palito]: '11',
    });
    assert.equal(r.estado, 400);
    const errores = erroresDe(r.html);
    assert.equal(errores.length, 2);
    assert.match(errores[0], new RegExp('El tacho .+ de Sambayón \\(artesanal\\) no llegó: escribí el motivo\\.'));
    assert.equal(errores[1], 'De Palito bombón se enviaron 10: poné cuántos llegaron (de 0 a 10).');
  });

  test('al recibir, el origen descuenta lo enviado y el destino suma lo que llegó', async () => {
    const [t1, t2] = tachosDelEnvio.map((t) => t.id_tacho);
    const r = await alem.enviar('/envios/' + numero + '/recibir', {
      ['llego_' + t1]: '1', ['motivo_tacho_' + t2]: 'se cayó del camión',
      ['recibido_' + palito]: '8', ['motivo_producto_' + palito]: 'dos rotos',
    });
    assert.equal(r.estado, 302);
    assert.equal(await alem.aviso('/envios'), 'Se recibió el envío N° ' + numero + '. Lo que llegó ya está en el stock de Alem. Quedó registrado el tacho que no llegó.');
    assert.deepEqual(await estadoTachos(), ['Alem LLENO 1', 'Entre Ríos FALTANTE 1', 'Entre Ríos LLENO 1']);
    assert.equal(await stockPalito(er), 10);
    assert.equal(await stockPalito(idAlem), 8);
  });

  test('un envío ya recibido no se recibe de nuevo', async () => {
    await alem.abrir('/envios/' + numero + '/recibir');
    assert.equal(await alem.aviso('/envios'), 'Ese envío no está para recibir en Alem.');
  });
});

describe('Cancelar un envío', () => {
  let numero;
  before(async () => { numero = await enviar({ ['sabor_' + sambayon]: '1' }); });

  test('solo lo cancela el origen, y con motivo', async () => {
    await alem.enviar('/envios/' + numero + '/cancelar', { motivo: 'no lo quiero' });
    assert.equal(await alem.aviso('/envios'), 'Ese envío no se puede cancelar desde Alem.');
    await fabrica.enviar('/envios/' + numero + '/cancelar', { motivo: '' });
    assert.equal(await fabrica.aviso('/envios'), 'Para cancelar el envío escribí el motivo.');
  });

  test('al cancelar, el tacho vuelve a estar lleno en el origen', async () => {
    await fabrica.enviar('/envios/' + numero + '/cancelar', { motivo: 'se armó por error' });
    assert.equal(await fabrica.aviso('/envios'), 'Se canceló el envío N° ' + numero + '. Sus tachos vuelven a estar disponibles en Entre Ríos.');
    assert.deepEqual(await estadoTachos(), ['Alem LLENO 1', 'Entre Ríos FALTANTE 1', 'Entre Ríos LLENO 1']);
  });
});
