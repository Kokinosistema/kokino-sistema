'use strict';

// Envios de la fabrica (Entre Rios) a Alem: armar, enviar, recibir con
// faltantes, recibir lo que llego sin estar en el ticket y cancelar. Usa
// Sambayon, Chocolate amargo, el Palito bombon y el Alfajor marroc, que no
// usa ninguna otra prueba.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, erroresDe, consultar, idProducto, idSabor, idSucursal, producir } = require('./ayudantes');

let sistema;
let fabrica; // empleado de Entre Rios
let alem; // empleado de Alem
let er;
let idAlem;
let sambayon;
let chocolate;
let palito;
let alfajor;

async function estadoTachos(sabor = sambayon) {
  const { rows } = await consultar(
    `SELECT s.nombre AS sucursal, t.estado, count(*)::int AS n
       FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote JOIN sucursales s ON s.id_sucursal = t.id_sucursal
      WHERE l.id_sabor = $1 GROUP BY s.nombre, t.estado ORDER BY 1, 2`,
    [sabor]
  );
  return rows.map((r) => r.sucursal + ' ' + r.estado + ' ' + r.n);
}

async function stockProducto(idSuc, producto = palito) {
  const { rows } = await consultar(
    'SELECT coalesce(sum(cantidad), 0)::int AS n FROM movimientos_producto WHERE id_producto = $1 AND id_sucursal = $2',
    [producto, idSuc]
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
  chocolate = await idSabor('Chocolate amargo', 'ARTESANAL');
  palito = await idProducto('Palito bombón');
  alfajor = await idProducto('Alfajor marroc');
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
    assert.equal(await stockProducto(er), 20);
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
    assert.equal(errores[1], 'De Palito bombón se enviaron 10: si llegaron más, poné 10 y agregá el resto abajo, en lo que llegó sin estar en el ticket.');
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
    assert.equal(await stockProducto(er), 10);
    assert.equal(await stockProducto(idAlem), 8);
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

// El ticket dice 1 de Sambayon, pero en la camioneta tambien iban 2 de
// Chocolate amargo. Alem los agrega al recibir: salen de Entre Rios los que
// vencen primero. Del chocolate hay 1 tacho de hace 3 dias y 2 de hoy.
describe('Lo que llegó sin estar en el ticket', () => {
  let numero;
  let tachoDelTicket;
  const haceTresDias = new Date(Date.now() - 3 * 86400000).toLocaleDateString('sv-SE');

  before(async () => {
    await producir(fabrica, er, 'sabor:' + chocolate, 1, haceTresDias);
    await producir(fabrica, er, 'sabor:' + chocolate, 2);
    await producir(fabrica, er, 'sabor:' + sambayon, 1);
    numero = await enviar({ ['sabor_' + sambayon]: '1' });
    ({ rows: [{ id_tacho: tachoDelTicket }] } = await consultar('SELECT id_tacho FROM traslado_tachos WHERE id_traslado = $1', [numero]));
  });

  test('ofrece los sabores que el origen tiene en tachos llenos', async () => {
    const { html } = await alem.abrir('/envios/' + numero + '/recibir');
    assert.match(html.replace(/\s+/g, ' '), /Chocolate amargo \(artesanal\) · 3 disponibles/);
  });

  test('pide el sabor y la cantidad, y un renglón vacío no cuenta', async () => {
    const r = await alem.enviar('/envios/' + numero + '/recibir', [
      ['llego_' + tachoDelTicket, '1'],
      ['agregado_sabor', String(chocolate)], ['agregado_sabor_cantidad', ''],
      ['agregado_sabor', ''], ['agregado_sabor_cantidad', '1'],
      ['agregado_sabor', ''], ['agregado_sabor_cantidad', ''],
    ]);
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), [
      'Poné cuántos tachos de Chocolate amargo (artesanal) llegaron sin estar en el ticket.',
      'Elegí el sabor de lo que llegó sin estar en el ticket.',
    ]);
  });

  test('no puede llegar de más lo que el origen no tiene, y si hay errores no se guarda nada', async () => {
    // Un sabor repetido se suma: 2 + 2 son 4, y en Entre Rios hay 3.
    const r = await alem.enviar('/envios/' + numero + '/recibir', [
      ['llego_' + tachoDelTicket, '1'],
      ['agregado_sabor', String(chocolate)], ['agregado_sabor_cantidad', '2'],
      ['agregado_sabor', String(chocolate)], ['agregado_sabor_cantidad', '2'],
    ]);
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['De Chocolate amargo (artesanal) quedan 3 tachos llenos en Entre Ríos: no pueden haber llegado 4 de más.']);
    // Lo cargado vuelve a aparecer, para no tener que escribirlo de nuevo.
    assert.equal(r.html.match(/name="agregado_sabor_cantidad"[^>]*value="2"/g).length, 2);
    const { rows: [envio] } = await consultar('SELECT estado FROM traslados WHERE id_traslado = $1', [numero]);
    assert.equal(envio.estado, 'EN_CAMINO');
    assert.deepEqual(await estadoTachos(chocolate), ['Entre Ríos LLENO 3']);
  });

  test('lo agregado sale del origen, los que vencen primero, y suma en el destino', async () => {
    const r = await alem.enviar('/envios/' + numero + '/recibir', [
      ['llego_' + tachoDelTicket, '1'],
      ['agregado_sabor', String(chocolate)], ['agregado_sabor_cantidad', '2'],
      ['agregado_sabor', ''], ['agregado_sabor_cantidad', ''],
    ]);
    assert.equal(r.estado, 302);
    assert.equal(await alem.aviso('/envios'), 'Se recibió el envío N° ' + numero + '. Lo que llegó ya está en el stock de Alem. Se sumaron los 2 tachos que no estaban en el ticket.');
    assert.deepEqual(await estadoTachos(chocolate), ['Alem LLENO 2', 'Entre Ríos LLENO 1']);
    // En Entre Rios queda uno de hoy: el de hace tres dias vencia primero y viajo.
    const { rows: quedan } = await consultar(
      `SELECT to_char(l.fecha_elaboracion, 'YYYY-MM-DD') AS elaborado
         FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote
        WHERE l.id_sabor = $1 AND t.id_sucursal = $2`,
      [chocolate, er]
    );
    assert.notEqual(quedan[0].elaborado, haceTresDias);
    const { rows: [marcas] } = await consultar(
      'SELECT count(*) FILTER (WHERE agregado_al_recibir)::int AS agregados, count(*)::int AS total FROM traslado_tachos WHERE id_traslado = $1',
      [numero]
    );
    assert.deepEqual(marcas, { agregados: 2, total: 3 });
  });

  test('el ticket muestra lo agregado aparte de lo que viajó', async () => {
    const { html } = await fabrica.abrir('/envios/' + numero);
    const ticket = /<article class="ticket">[\s\S]*<\/article>/.exec(html)[0];
    assert.doesNotMatch(ticket, /Chocolate amargo/);
    assert.match(ticket, /Sambayón/);
    assert.match(html, /Lo que llegó sin estar en el ticket/);
    assert.equal(html.match(/<li>Tacho .+ de Chocolate amargo \(artesanal\)<\/li>/g).length, 2);
  });
});

// El ticket dice 10 palitos, pero llegaron 12, y ademas 3 alfajores que no
// estaban. Alem deja 10 en el renglon del ticket y agrega el resto: 2 palitos
// (cargados en dos renglones de 1, que se suman) y 3 alfajores.
describe('Productos que llegaron sin estar en el ticket', () => {
  let numero;
  let palitosAntes;

  before(async () => {
    await producir(fabrica, er, 'producto:' + palito, 20);
    await producir(fabrica, er, 'producto:' + alfajor, 5);
    palitosAntes = { er: await stockProducto(er), alem: await stockProducto(idAlem) };
    numero = await enviar({ ['producto_' + palito]: '10' });
  });

  test('ofrece los productos que el origen tiene disponibles, sin contar lo que va en camino', async () => {
    const { html } = await alem.abrir('/envios/' + numero + '/recibir');
    const texto = html.replace(/\s+/g, ' ');
    assert.match(texto, new RegExp('Palito bombón · ' + (palitosAntes.er - 10) + ' un disponibles'));
    assert.match(texto, /Alfajor marroc · 5 un disponibles/);
  });

  test('pide el producto y la cantidad', async () => {
    const r = await alem.enviar('/envios/' + numero + '/recibir', [
      ['recibido_' + palito, '10'],
      ['agregado_producto', String(alfajor)], ['agregado_producto_cantidad', ''],
      ['agregado_producto', ''], ['agregado_producto_cantidad', '3'],
    ]);
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), [
      'Poné cuánto llegó de Alfajor marroc sin estar en el ticket.',
      'Elegí el producto de lo que llegó sin estar en el ticket.',
    ]);
  });

  test('no puede llegar de más lo que el origen no tiene, y si hay errores no se guarda nada', async () => {
    const r = await alem.enviar('/envios/' + numero + '/recibir', [
      ['recibido_' + palito, '10'],
      ['agregado_producto', String(alfajor)], ['agregado_producto_cantidad', '4'],
      ['agregado_producto', String(alfajor)], ['agregado_producto_cantidad', '2'],
    ]);
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['De Alfajor marroc hay 5 disponibles en Entre Ríos: no pueden haber llegado 6 de más.']);
    const { rows: [envio] } = await consultar('SELECT estado FROM traslados WHERE id_traslado = $1', [numero]);
    assert.equal(envio.estado, 'EN_CAMINO');
    assert.equal(await stockProducto(er, alfajor), 5);
  });

  test('lo agregado sale del origen y suma en el destino, también lo que llegó de más de un producto del ticket', async () => {
    const r = await alem.enviar('/envios/' + numero + '/recibir', [
      ['recibido_' + palito, '10'],
      ['agregado_producto', String(palito)], ['agregado_producto_cantidad', '1'],
      ['agregado_producto', String(palito)], ['agregado_producto_cantidad', '1'],
      ['agregado_producto', String(alfajor)], ['agregado_producto_cantidad', '3'],
      ['agregado_producto', ''], ['agregado_producto_cantidad', ''],
    ]);
    assert.equal(r.estado, 302);
    assert.equal(await alem.aviso('/envios'), 'Se recibió el envío N° ' + numero + '. Lo que llegó ya está en el stock de Alem. Se sumaron los productos que no estaban en el ticket.');
    assert.equal(await stockProducto(er), palitosAntes.er - 12);
    assert.equal(await stockProducto(idAlem), palitosAntes.alem + 12);
    assert.equal(await stockProducto(er, alfajor), 2);
    assert.equal(await stockProducto(idAlem, alfajor), 3);
    const { rows } = await consultar(
      `SELECT p.nombre, tp.cantidad::int, tp.cantidad_recibida::int AS recibida, tp.agregado_al_recibir AS agregado
         FROM traslado_productos tp JOIN productos p ON p.id_producto = tp.id_producto
        WHERE tp.id_traslado = $1 ORDER BY p.nombre, tp.agregado_al_recibir`,
      [numero]
    );
    assert.deepEqual(rows, [
      { nombre: 'Alfajor marroc', cantidad: 3, recibida: 3, agregado: true },
      { nombre: 'Palito bombón', cantidad: 10, recibida: 10, agregado: false },
      { nombre: 'Palito bombón', cantidad: 2, recibida: 2, agregado: true },
    ]);
  });

  test('el ticket muestra los productos agregados aparte de lo que viajó', async () => {
    const { html } = await fabrica.abrir('/envios/' + numero);
    const ticket = /<article class="ticket">[\s\S]*<\/article>/.exec(html)[0];
    assert.doesNotMatch(ticket, /Alfajor marroc/);
    assert.match(ticket.replace(/\s+/g, ' '), /Palito bombón<\/td> <td class="numero">10 un/);
    assert.match(html, /<li>Palito bombón: 2 un<\/li>/);
    assert.match(html, /<li>Alfajor marroc: 3 un<\/li>/);
  });
});
