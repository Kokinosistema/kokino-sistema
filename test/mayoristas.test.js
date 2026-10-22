'use strict';

// Venta mayorista de tachos (solo duenos): vender a cuenta o pagando, cobrar
// lo que se debe, devolver envases, anular y prever que fabricar. Se vende
// desde Cotizar (test/cotizar.test.js prueba esa pantalla en detalle). Usa el
// Dulce de leche de la linea familiar, que no usa ninguna otra prueba.

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

// "Se lo lleva" en Cotizar: tantos tachos de Dulce de leche, a ese precio,
// con los envases prestados salvo que se diga otra cosa.
function seLoLleva(cliente, tachos, precio, compraEnvases = 'NO') {
  const pares = [['id_sucursal', String(er)], ['compra_envases', compraEnvases]];
  if (tachos) pares.push(['renglon_sabor', String(ddl)], ['renglon_tachos', String(tachos)], ['renglon_precio', precio]);
  return dueno.enviar('/cotizar/' + cliente, pares);
}

// Cotiza, revisa y confirma con el pago dado. Devuelve el numero de venta.
async function vender(cliente, tachos, precio, pago) {
  const r = await seLoLleva(cliente, tachos, precio);
  assert.equal(r.estado, 302, erroresDe(r.html).join(' '));
  assert.equal((await dueno.abrir('/cotizar/' + cliente + '/revisar')).estado, 200);
  const confirmado = await dueno.enviar('/cotizar/' + cliente + '/confirmar', pago);
  assert.equal(confirmado.estado, 302, erroresDe(confirmado.html).join(' '));
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

describe('Vender', () => {
  test('el empleado no entra a la ficha ni a cotizar', async () => {
    assert.equal((await empleado.abrir('/clientes/' + conCuenta)).estado, 403);
    assert.equal((await empleado.abrir('/cotizar/' + conCuenta)).estado, 403);
  });

  test('la venta de antes ya no existe', async () => {
    assert.equal((await dueno.abrir('/clientes/' + conCuenta + '/vender')).estado, 404);
    assert.equal((await dueno.abrir('/clientes/precios')).estado, 404);
  });

  test('pide al menos un sabor y si compra los envases', async () => {
    const r = await seLoLleva(conCuenta, 0, '', '');
    assert.equal(r.estado, 400);
    assert.deepEqual(erroresDe(r.html), ['Agregá al menos un sabor.', 'Respondé si compra los envases.']);
  });

  test('no deja vender más tachos de los que hay', async () => {
    const r = await seLoLleva(conCuenta, 5, '$30.000');
    assert.deepEqual(erroresDe(r.html), ['De Dulce de leche (familiar) hay 4 tachos llenos en Entre Ríos: no alcanzan para 5.']);
  });

  test('a un cliente sin cuenta corriente no se le vende a cuenta', async () => {
    assert.equal((await seLoLleva(sinCuenta, 1, '$38.000')).estado, 302);
    const r = await dueno.enviar('/cotizar/' + sinCuenta + '/confirmar', { pago: 'CUENTA' });
    assert.deepEqual(erroresDe(r.html), ['Kiosco sin cuenta no tiene cuenta corriente habilitada. Para venderle a cuenta, cargale un límite en Editar cliente.']);
  });
});

describe('Venta a cuenta, cobros y envases', () => {
  let venta;

  test('vende 2 tachos retornables a cuenta: salen del stock y quedan debiendo', async () => {
    venta = await vender(conCuenta, 2, '$30.000', { pago: 'CUENTA' });
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
    assert.equal((await seLoLleva(conCuenta, 1, '$38.000')).estado, 302);
    const r = await dueno.enviar('/cotizar/' + conCuenta + '/confirmar', { pago: 'AHORA', id_medio_pago: await idMedio('PedidosYa (online)') });
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
    venta = await vender(sinCuenta, 1, '$38.000', { pago: 'AHORA', id_medio_pago: await idMedio('Efectivo') });
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

// El envase comprado se cobra aparte del helado (2026-10-22). Todavia no hay
// pantalla que lo cargue, asi que la venta se arma directo en la base.
describe('Envase cobrado aparte', () => {
  let venta;
  let tacho;

  before(async () => {
    const { rows: [u] } = await consultar("SELECT id_usuario FROM usuarios WHERE username = 'dueno.prueba'");
    ({ rows: [{ id_venta: venta }] } = await consultar(
      `INSERT INTO ventas (id_usuario, id_cliente, canal_venta, tipo_venta, id_sucursal)
       VALUES ($1, $2, 'MAYORISTA', 'MAYORISTA', $3) RETURNING id_venta`,
      [u.id_usuario, conCuenta, er]
    ));
    ({ rows: [{ id_tacho: tacho }] } = await consultar(
      `SELECT t.id_tacho FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote
        WHERE l.id_sabor = $1 AND t.estado = 'LLENO' AND t.id_sucursal = $2 LIMIT 1`,
      [ddl, er]
    ));
  });

  test('un envase prestado no se cobra', async () => {
    await assert.rejects(
      consultar("INSERT INTO venta_tachos (id_venta, id_tacho, envase, precio_aplicado, precio_envase) VALUES ($1, $2, 'RETORNABLE', 40000, 5000)", [venta, tacho]),
      /venta_tachos_envase_prestado_gratis_check/
    );
  });

  test('el total de la venta suma el helado y el envase comprado', async () => {
    await consultar("INSERT INTO venta_tachos (id_venta, id_tacho, envase, precio_aplicado, precio_envase) VALUES ($1, $2, 'INCLUIDO', 40000, 5000)", [venta, tacho]);
    const { rows } = await consultar('SELECT total FROM ventas_totales WHERE id_venta = $1', [venta]);
    assert.equal(Number(rows[0].total), 45000);
  });

  after(() => consultar("UPDATE ventas SET fecha_anulacion = now(), id_usuario_anulacion = id_usuario, motivo_anulacion = 'prueba' WHERE id_venta = $1", [venta]));
});

// El pronostico usa las fechas de las compras: se venden por la pantalla y
// despues se corren dias para atras en la base, para saber que tiene que dar.
describe('Qué fabricar para los mayoristas', () => {
  // Compra cada 10 dias, 3 tachos por compra, la ultima hace 7: la proxima
  // cae a los 3 dias y la siguiente a los 13, lejos de los bordes de los
  // plazos (7, 14 y 30). Con la ultima hace 6, la segunda caia justo en el
  // dia 14, y la prueba pasaba o no segun los milisegundos entre ventas.
  let vuelve;
  let noVuelve; // compraba cada 10 dias, pero hace 30 que no compra

  const atrasar = (venta, dias) => consultar("UPDATE ventas SET fecha_hora = now() - $2 * interval '1 day' WHERE id_venta = $1", [venta, dias]);
  const diaMes = (dias) => new Date(Date.now() + dias * 86400000).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' });
  // La fila del Dulce de leche en la tabla de que fabricar: [se esperan, llenos, fabricar].
  async function filaDdl(dias) {
    const { html } = await dueno.abrir('/clientes/estadisticas' + (dias ? '?dias=' + dias : ''));
    const m = /Dulce de leche \(familiar\)<\/td>\s*<td class="numero">unos (\d+)<\/td>\s*<td class="numero">(\d+)<\/td>\s*<td class="numero">(.*?)<\/td>/.exec(html);
    return m && [Number(m[1]), Number(m[2]), m[3].replace(/<[^>]+>/g, '')];
  }

  before(async () => {
    await producir(dueno, er, 'sabor:' + ddl, 8);
    const { rows } = await consultar(
      `INSERT INTO clientes (nombre_razon_social, tipo_cliente, limite_cuenta_corriente, plazo_pago_dias)
       VALUES ('Kiosco que vuelve', 'MAYORISTA', 1000000, 30), ('Kiosco que no vuelve', 'MAYORISTA', 1000000, 30)
       RETURNING id_cliente`
    );
    [vuelve, noVuelve] = rows.map((r) => r.id_cliente);
    const aCuenta = { pago: 'CUENTA' };
    await atrasar(await vender(vuelve, 3, '$30.000', aCuenta), 17);
    await atrasar(await vender(vuelve, 3, '$30.000', aCuenta), 7);
    await atrasar(await vender(noVuelve, 1, '$30.000', aCuenta), 40);
    await atrasar(await vender(noVuelve, 1, '$30.000', aCuenta), 30);
  });

  test('en 2 semanas espera 2 compras de 3 tachos y pide fabricar lo que falta', async () => {
    // 2 llenos que quedaban + 8 fabricados - 8 vendidos = 2 llenos.
    assert.deepEqual(await filaDdl(), [6, 2, '4 tachos']);
  });

  test('el plazo cambia lo que se espera', async () => {
    assert.deepEqual(await filaDdl(7), [3, 2, '1 tacho']);
    assert.deepEqual(await filaDdl(30), [9, 2, '7 tachos']);
    // Un plazo que no esta entre los ofrecidos usa el de 2 semanas.
    assert.deepEqual(await filaDdl(1000), [6, 2, '4 tachos']);
  });

  test('cliente por cliente: cuándo vuelve, y quiénes no se cuentan', async () => {
    const { html } = await dueno.abrir('/clientes/estadisticas');
    assert.match(html, new RegExp('Kiosco que vuelve</a>:\\s*<strong>unos 6 tachos</strong>[\\s\\S]*?Próxima compra alrededor del ' + diaMes(3)
      + '\\.\\s*Compra cada 10 días y lleva unos 3 tachos'));
    const afuera = html.slice(html.indexOf('No se cuentan'));
    assert.match(afuera, /Kiosco que no vuelve<\/a>:\s*<span class="pista">\s*hace 30 días que no compra, más del doble de lo habitual \(cada 10 días\)/);
    assert.match(afuera, /Kiosco con cuenta<\/a>:\s*<span class="pista">\s*tiene una sola compra en los últimos 6 meses/);
    // La venta anulada no cuenta como compra.
    assert.doesNotMatch(html, /Kiosco sin cuenta<\/a>:/);
  });

  test('en la ficha del cliente, la próxima compra probable', async () => {
    const { html } = await dueno.abrir('/clientes/' + vuelve);
    assert.match(html, new RegExp('Próxima compra probable</h3>\\s*<p class="metrica-valor-chico">Alrededor del ' + diaMes(3) + '</p>'));
    assert.match(html, /Suele llevar unos 3 tachos\. Es un promedio\./);
    assert.match((await dueno.abrir('/clientes/' + noVuelve)).html, /Hace más del doble de lo habitual que no compra: no se puede prever\./);
  });
});
