'use strict';

// Lo que comparten las pruebas: levantar el sistema contra la base de
// prueba, entrar con un usuario y usarlo como lo haria una persona (abrir
// pantallas, mandar formularios, leer avisos y errores).
//
// Las pruebas no llaman funciones internas: hablan con el sistema por HTTP,
// igual que el navegador. Asi prueban la pantalla, la ruta y las reglas de la
// base juntas, que es lo que de verdad usa el mostrador.

const { urlDePrueba, exigirBaseDePrueba, USUARIOS } = require('./base-de-prueba');

// Antes de cargar el sistema: que se conecte a la base de prueba y no a la
// del .env, y en hora argentina, como en server.js.
const url = urlDePrueba();
exigirBaseDePrueba(url);
process.env.DATABASE_URL = url;
process.env.TZ = process.env.ZONA_HORARIA || 'America/Argentina/Tucuman';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-las-pruebas';

const { crearAplicacion } = require('../src/app');
const { consultar, pool } = require('../src/db');

// Levanta el sistema en un puerto libre. Devuelve la direccion y como apagarlo.
function levantar() {
  return new Promise((resolver) => {
    const servidor = crearAplicacion().listen(0, () => {
      resolver({
        base: 'http://localhost:' + servidor.address().port,
        apagar: () => new Promise((listo) => servidor.close(() => pool.end().then(listo))),
      });
    });
  });
}

// El texto de la pagina viene escapado (&#34; por comillas, etc.).
function desescapar(texto) {
  return texto
    .replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

// Una persona usando el sistema: guarda su sesion entre pedido y pedido.
class Navegador {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }

  async pedir(metodo, ruta, campos) {
    const opciones = { method: metodo, redirect: 'manual', headers: {} };
    if (this.cookie) opciones.headers.cookie = this.cookie;
    if (campos) {
      opciones.body = new URLSearchParams(campos);
      opciones.headers['content-type'] = 'application/x-www-form-urlencoded';
    }
    const respuesta = await fetch(this.base + ruta, opciones);
    const nueva = respuesta.headers.getSetCookie().find((c) => c.startsWith('kokino.sid='));
    if (nueva) this.cookie = nueva.split(';')[0];
    const destino = respuesta.headers.get('location');
    return { estado: respuesta.status, destino, html: await respuesta.text() };
  }

  abrir(ruta) {
    return this.pedir('GET', ruta);
  }

  // Manda un formulario. Los campos van como en el navegador: un objeto, o
  // una lista de pares si un campo se repite.
  enviar(ruta, campos = {}) {
    return this.pedir('POST', ruta, campos);
  }

  async entrar(quien) {
    const u = USUARIOS[quien];
    const r = await this.enviar('/login', { username: u.username, contrasena: u.contrasena });
    if (r.estado !== 302) throw new Error('No pudo entrar ' + u.username + ' (respondio ' + r.estado + ')');
    return r;
  }

  // El aviso que deja una accion (por ejemplo, "Venta registrada: $9.000.")
  // se ve en la pantalla siguiente.
  async aviso(ruta = '/') {
    return avisoDe((await this.abrir(ruta)).html);
  }
}

function avisoDe(html) {
  const m = /<p class="aviso" role="status">([^<]*)<\/p>/.exec(html);
  return m ? desescapar(m[1]) : null;
}

// Los errores de un formulario rechazado (la lista roja arriba).
function erroresDe(html) {
  const lista = /<ul class="errores"[^>]*>([\s\S]*?)<\/ul>/.exec(html);
  if (!lista) return [];
  return [...lista[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => desescapar(m[1]));
}

// Datos que las pruebas necesitan buscar en la base: los numeros cambian
// entre bases, los nombres no.
async function idProducto(nombre) {
  const { rows } = await consultar('SELECT id_producto FROM productos WHERE nombre = $1', [nombre]);
  if (!rows[0]) throw new Error('No existe el producto ' + nombre);
  return rows[0].id_producto;
}

async function idMedio(nombre) {
  const { rows } = await consultar('SELECT id_medio_pago FROM medios_pago WHERE nombre = $1', [nombre]);
  if (!rows[0]) throw new Error('No existe el medio de pago ' + nombre);
  return rows[0].id_medio_pago;
}

// Solo categorias de productos: hay nombres repetidos entre productos e
// insumos (Cafeteria existe en los dos).
async function idCategoria(nombre) {
  const { rows } = await consultar("SELECT id_categoria FROM categorias WHERE nombre = $1 AND tipo = 'PRODUCTO'", [nombre]);
  if (!rows[0]) throw new Error('No existe la categoria de productos ' + nombre);
  return rows[0].id_categoria;
}

async function idSucursal(nombre) {
  const { rows } = await consultar('SELECT id_sucursal FROM sucursales WHERE nombre = $1', [nombre]);
  if (!rows[0]) throw new Error('No existe la sucursal ' + nombre);
  return rows[0].id_sucursal;
}

// Abre la caja de la sucursal del navegador (si ya habia una abierta, la
// cierra antes, para arrancar de cero). Devuelve el id de la sucursal.
async function cajaNueva(navegador, montoApertura = '$20.000') {
  const pantalla = await navegador.abrir('/caja');
  const sucursal = /name="id_sucursal" value="(\d+)"/.exec(pantalla.html)[1];
  if (/action="\/caja\/cerrar"|href="\/caja\/cerrar"/.test(pantalla.html)) {
    await navegador.enviar('/caja/cerrar', { id_sucursal: sucursal, monto_cierre_declarado: '$0' });
  }
  const { html } = await navegador.abrir('/caja');
  const turno = /name="turno" value="([^"]+)"/.exec(html)[1];
  const r = await navegador.enviar('/caja/abrir', { id_sucursal: sucursal, turno, monto_apertura: montoApertura });
  if (r.estado !== 302) throw new Error('No se pudo abrir la caja: ' + erroresDe(r.html).join(' '));
  return Number(sucursal);
}

module.exports = {
  levantar, Navegador, avisoDe, erroresDe, consultar, idProducto, idMedio, idCategoria, idSucursal, cajaNueva,
};
