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

describe('Límite de intentos de login', () => {
  const USUARIO = 'alem.prueba';
  const CLAVE = 'clave-de-prueba-2';
  const intentar = (nav, username, contrasena) => nav.enviar('/login', { username, contrasena });

  test('entrar bien antes del límite vuelve el contador a cero', async () => {
    const nav = new Navegador(sistema.base);
    for (let i = 0; i < 4; i++) assert.equal((await intentar(nav, USUARIO, 'mal')).estado, 401);
    assert.equal((await intentar(nav, USUARIO, CLAVE)).estado, 302);
    // Si no se hubiera reiniciado, el quinto error de ahora lo bloquearia.
    const otro = new Navegador(sistema.base);
    for (let i = 0; i < 4; i++) await intentar(otro, USUARIO, 'mal');
    assert.equal((await intentar(otro, USUARIO, CLAVE)).estado, 302);
  });

  test('después de 5 errores, ni con la contraseña correcta entra', async () => {
    const nav = new Navegador(sistema.base);
    for (let i = 0; i < 5; i++) await intentar(nav, USUARIO, 'mal');
    const r = await intentar(nav, USUARIO, CLAVE);
    assert.equal(r.estado, 429);
    assert.match(r.html, /Demasiados intentos con este usuario\. Probá de nuevo en 5 minutos\./);
  });

  test('el bloqueo de un usuario no afecta a otro', async () => {
    const nav = new Navegador(sistema.base);
    assert.equal((await nav.entrar('empleado')).estado, 302);
  });

  test('un usuario que no existe se bloquea igual, para no revelar cuáles existen', async () => {
    const nav = new Navegador(sistema.base);
    for (let i = 0; i < 5; i++) await intentar(nav, 'no.existe.tampoco', 'mal');
    assert.equal((await intentar(nav, 'no.existe.tampoco', 'mal')).estado, 429);
  });

  test('el bloqueo se levanta solo a los 5 minutos', () => {
    // Con una hora inventada, para no esperar 5 minutos de verdad.
    const intentos = require('../src/intentos');
    const t = Date.parse('2026-01-01T10:00:00');
    for (let i = 0; i < intentos.MAXIMO; i++) intentos.anotarFallo('reloj.prueba', t);
    assert.equal(intentos.minutosBloqueado('reloj.prueba', t), 5);
    assert.equal(intentos.minutosBloqueado('reloj.prueba', t + 4 * 60000 + 1), 1);
    assert.equal(intentos.minutosBloqueado('reloj.prueba', t + 5 * 60000), 0);
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

  test('en su Inicio tiene acceso directo a Vender y a Pedidos Ya', async () => {
    const { html } = await nav.abrir('/');
    assert.match(html, /class="acceso acceso-principal" href="\/ventas"/);
    assert.match(html, /class="acceso" href="\/pedidosya"[\s\S]*?Pedidos Ya/);
  });

  test('no ve en el menú las secciones de los dueños', async () => {
    const { html } = await nav.abrir('/');
    assert.doesNotMatch(html, /href="\/usuarios"/);
    assert.doesNotMatch(html, /href="\/productos"/);
    assert.match(html, /href="\/pedidosya"/);
  });
});
