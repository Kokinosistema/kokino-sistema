'use strict';

// Quien puede entrar y a que pantallas.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador } = require('./ayudantes');

let sistema;
before(async () => { sistema = await levantar(); });
after(() => sistema.apagar());

describe('Login', () => {
  test('con una contraseña equivocada no entra, y no dice si el usuario existe', async () => {
    const nav = new Navegador(sistema.base);
    const conUsuario = await nav.enviar('/login', { username: 'empleado.prueba', contrasena: 'mal' });
    const sinUsuario = await nav.enviar('/login', { username: 'no.existe', contrasena: 'mal' });
    assert.equal(conUsuario.estado, 401);
    assert.equal(sinUsuario.estado, 401);
    // El mismo mensaje en los dos casos: si fueran distintos, se podria
    // averiguar que usuarios existen.
    const mensaje = (html) => /class="error[^"]*"[^>]*>([^<]*)/.exec(html)?.[1];
    assert.equal(mensaje(conUsuario.html), mensaje(sinUsuario.html));
  });

  test('sin entrar, cualquier pantalla manda al login', async () => {
    const nav = new Navegador(sistema.base);
    const r = await nav.abrir('/ventas');
    assert.equal(r.estado, 302);
    assert.match(r.destino, /\/login$/);
  });

  test('al salir, la sesión deja de servir', async () => {
    const nav = new Navegador(sistema.base);
    await nav.entrar('empleado');
    assert.equal((await nav.abrir('/ventas')).estado, 200);
    await nav.enviar('/logout');
    assert.match((await nav.abrir('/ventas')).destino, /\/login$/);
  });
});

// Que cada pantalla del menu abra para un dueno. Parece obvio, pero un error
// en una vista (por ejemplo, un nombre repetido) tira la pagina entera, y
// sin esto no se nota hasta que alguien entra.
describe('El dueño', () => {
  let nav;
  before(async () => {
    nav = new Navegador(sistema.base);
    await nav.entrar('dueno');
  });

  for (const ruta of ['/', '/ventas', '/pedidosya', '/caja', '/fabricacion', '/mercaderia', '/envios', '/recetas',
    '/historial', '/clientes', '/productos', '/insumos', '/costos', '/proveedores', '/usuarios', '/sucursales']) {
    test('abre ' + ruta, async () => {
      assert.equal((await nav.abrir(ruta)).estado, 200);
    });
  }
});

describe('El empleado', () => {
  let nav;
  before(async () => {
    nav = new Navegador(sistema.base);
    await nav.entrar('empleado');
  });

  for (const ruta of ['/', '/ventas', '/pedidosya', '/caja', '/fabricacion', '/mercaderia', '/envios', '/recetas']) {
    test('entra a ' + ruta, async () => {
      assert.equal((await nav.abrir(ruta)).estado, 200);
    });
  }

  for (const ruta of ['/productos', '/usuarios', '/costos', '/clientes', '/sucursales', '/proveedores',
    '/insumos', '/pedidosya/agregar', '/productos/categorias/1/editar']) {
    test('no entra a ' + ruta + ', que es de los dueños', async () => {
      assert.equal((await nav.abrir(ruta)).estado, 403);
    });
  }

  test('no ve en el menú las secciones de los dueños', async () => {
    const { html } = await nav.abrir('/');
    assert.doesNotMatch(html, /href="\/usuarios"/);
    assert.doesNotMatch(html, /href="\/productos"/);
    assert.match(html, /href="\/pedidosya"/);
  });
});
