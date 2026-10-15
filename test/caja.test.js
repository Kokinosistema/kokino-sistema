'use strict';

// Un turno de caja: abrirla, registrar salidas, cerrarla y que la cuenta del
// efectivo de exacta. Corre con el empleado de Alem, para no compartir caja
// con las pruebas de ventas (Entre Rios).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, erroresDe, consultar, idProducto, idMedio, cajaNueva } = require('./ayudantes');

let sistema;
let nav;
let dueno;
let sucursal;
before(async () => {
  sistema = await levantar();
  nav = new Navegador(sistema.base);
  await nav.entrar('empleadoAlem');
});
after(() => sistema.apagar());

describe('Abrir la caja', () => {
  test('pide con cuánto efectivo arranca', async () => {
    const { html } = await nav.abrir('/caja');
    const idSuc = /name="id_sucursal" value="(\d+)"/.exec(html)[1];
    const turno = /name="turno" value="([^"]+)"/.exec(html)[1];
    const r = await nav.enviar('/caja/abrir', { id_sucursal: idSuc, turno, monto_apertura: '' });
    assert.equal(r.estado, 400);
    assert.match(erroresDe(r.html)[0], /Poné con cuánto efectivo arranca la caja/);
  });

  test('abre, y un doble click no abre una segunda', async () => {
    sucursal = await cajaNueva(nav, '$20.000');
    const { html } = await nav.abrir('/caja');
    const turno = /name="turno" value="([^"]+)"/.exec(html);
    // Con la caja abierta, la pantalla ya no ofrece abrir otra...
    assert.equal(turno, null);
    // ...y si el formulario viejo se manda igual, la base no la deja abrir.
    const r = await nav.enviar('/caja/abrir', { id_sucursal: sucursal, turno: 'MANANA_TARDE', monto_apertura: '$20.000' });
    assert.equal(r.estado, 302);
    assert.match(await nav.aviso('/caja'), /Ya hay una caja abierta/);
    const { rows } = await consultar('SELECT count(*)::int AS n FROM cajas WHERE id_sucursal = $1 AND fecha_cierre IS NULL', [sucursal]);
    assert.equal(rows[0].n, 1);
  });
});

describe('Salidas de la caja', () => {
  test('una compra necesita tipo, monto y en qué se gastó', async () => {
    const r = await nav.enviar('/caja/egresos', { id_sucursal: sucursal, tipo_egreso: '', monto: '', id_medio_pago: await idMedio('Efectivo'), descripcion: '' });
    assert.equal(r.estado, 400);
    const errores = erroresDe(r.html).join(' ');
    assert.match(errores, /Elegí qué tipo de salida es/);
    assert.match(errores, /Poné el monto de la salida/);
  });

  test('registra una compra en efectivo', async () => {
    const r = await nav.enviar('/caja/egresos', {
      id_sucursal: sucursal, tipo_egreso: 'COMPRA', monto: '$3.500',
      id_medio_pago: await idMedio('Efectivo'), descripcion: 'bolsas y servilletas',
    });
    assert.equal(r.estado, 302);
    assert.equal(await nav.aviso('/caja'), 'Salida de $3.500 registrada.');
  });
});

describe('Cerrar la caja', () => {
  test('la cuenta del efectivo suma lo cobrado en efectivo y nada más', async () => {
    const cono = await idProducto('Cono simple'); // $4.500
    const termico = await idProducto('Térmico 1/2 kg'); // $15.000
    // $9.000 en efectivo (paga con $10.000) y $15.000 con débito, que no va al cajón.
    await nav.enviar('/ventas/pedido', { id_sucursal: sucursal, id_producto: cono, accion: 'agregar', cantidad: 2 });
    await nav.enviar('/ventas/cobrar', { id_sucursal: sucursal, canal: 'MOSTRADOR', id_medio_pago: await idMedio('Efectivo'), paga_con: '$10.000' });
    await nav.enviar('/ventas/pedido', { id_sucursal: sucursal, id_producto: termico, accion: 'agregar' });
    await nav.enviar('/ventas/cobrar', { id_sucursal: sucursal, canal: 'TELEFONO', id_medio_pago: await idMedio('Débito') });

    const { html } = await nav.abrir('/caja/cerrar');
    const texto = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(texto, /Con lo que se abrió \$20\.000/);
    assert.match(texto, /Cobrado en efectivo \+ \$9\.000/);
    assert.match(texto, /Salidas en efectivo − \$3\.500/);
    assert.match(texto, /Debería haber en caja \$25\.500/);
  });

  test('el empleado no ve lo cobrado por medio de pago', async () => {
    const { html } = await nav.abrir('/caja/cerrar');
    assert.doesNotMatch(html, /Lo cobrado en el turno/);
    assert.doesNotMatch((await nav.abrir('/caja')).html, /Lo cobrado en el turno/);
  });

  test('el dueño ve lo cobrado por medio y por canal, sin las ventas anuladas', async () => {
    // Una venta mas, con debito, que se anula: no tiene que sumar.
    await nav.enviar('/ventas/pedido', { id_sucursal: sucursal, id_producto: await idProducto('Cono simple'), accion: 'agregar' });
    await nav.enviar('/ventas/cobrar', { id_sucursal: sucursal, canal: 'MOSTRADOR', id_medio_pago: await idMedio('Débito') });
    const { rows } = await consultar('SELECT max(id_venta) AS id FROM ventas');
    await nav.enviar('/ventas/' + rows[0].id + '/anular', { motivo: 'prueba del resumen' });

    dueno = new Navegador(sistema.base);
    await dueno.entrar('dueno');
    await dueno.enviar('/sucursal', { id_sucursal: sucursal });
    const resumen = resumenDe((await dueno.abrir('/caja/cerrar')).html);
    assert.deepEqual(resumen, [
      'Efectivo 1 $9.000', 'Débito 1 $15.000', 'Total $24.000',
      'Mostrador 1 $9.000', 'Teléfono 1 $15.000',
    ]);
    // El mismo resumen en la pantalla de la caja, con el turno abierto.
    assert.deepEqual(resumenDe((await dueno.abrir('/caja')).html), resumen);
  });

  test('si se cuenta menos de lo que debería haber, registra el faltante', async () => {
    const r = await nav.enviar('/caja/cerrar', { id_sucursal: sucursal, monto_cierre_declarado: '$25.000' });
    assert.equal(r.estado, 302);
    assert.equal(await nav.aviso('/caja'), 'Caja cerrada. Faltaron $500.');
  });

  test('con la caja cerrada no se puede vender', async () => {
    const { html } = await nav.abrir('/ventas');
    assert.match(html, /No hay caja abierta/);
  });
});

describe('Detalle de un turno cerrado', () => {
  let idCaja;
  before(async () => {
    const { rows } = await consultar('SELECT max(id_caja) AS id FROM cajas WHERE id_sucursal = $1 AND fecha_cierre IS NOT NULL', [sucursal]);
    idCaja = rows[0].id;
  });

  test('el dueño lo abre desde "Últimos cierres" y ve el arqueo y el resumen', async () => {
    assert.match((await dueno.abrir('/caja')).html, new RegExp('href="/caja/' + idCaja + '">Ver detalle'));
    const { estado, html } = await dueno.abrir('/caja/' + idCaja);
    assert.equal(estado, 200);
    const texto = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(texto, /Debería haber en caja \$25\.500 Se contó \$25\.000 Diferencia faltó \$500/);
    assert.deepEqual(resumenDe(html), [
      'Efectivo 1 $9.000', 'Débito 1 $15.000', 'Total $24.000',
      'Mostrador 1 $9.000', 'Teléfono 1 $15.000',
    ]);
    assert.match(texto, /bolsas y servilletas/);
  });

  test('el empleado no lo puede abrir ni ve el enlace', async () => {
    assert.equal((await nav.abrir('/caja/' + idCaja)).estado, 403);
    assert.doesNotMatch((await nav.abrir('/caja')).html, /Ver detalle/);
  });

  test('un turno que no existe da "no encontrado"', async () => {
    assert.equal((await dueno.abrir('/caja/999999')).estado, 404);
  });
});

// Los renglones del resumen de lo cobrado, como texto: "Efectivo 1 $9.000".
function resumenDe(html) {
  const seccion = /<h2>Lo cobrado en el turno<\/h2>([\s\S]*?)<\/section>/.exec(html);
  if (!seccion) return null;
  return [...seccion[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((fila) => fila && !/^Por (medio|canal)/.test(fila));
}
