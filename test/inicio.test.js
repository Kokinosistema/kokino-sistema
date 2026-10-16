'use strict';

// Los graficos del Inicio de los duenos (2026-10-16): los ultimos 14 dias
// con el mismo dia de la semana anterior al lado, como pagan y por donde
// compran en barras partidas, y las horas pico en un mapa de calor.
//
// Las demas pruebas venden con fecha de hoy. Aca se venden dos cosas y se
// corren 8 dias para atras: asi se sabe cual es el pico y con que se compara
// el dia de ayer (8 dias atras es el mismo dia de la semana que ayer).

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, Navegador, consultar, idProducto, idMedio, cajaNueva } = require('./ayudantes');

let sistema;
let dueno;
let html;
let totalDelPico;
const hace8 = new Date(Date.now() - 8 * 86400000);

const pesos = (n) => '$' + Math.round(n).toLocaleString('es-AR');
const desescapar = (t) => t.replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

before(async () => {
  sistema = await levantar();
  const empleado = new Navegador(sistema.base);
  await empleado.entrar('empleado');
  const sucursal = await cajaNueva(empleado);
  const debito = await idMedio('Débito');
  async function venderA(cantidad, hora) {
    await empleado.enviar('/ventas/pedido', { id_sucursal: sucursal, id_producto: await idProducto('Cono simple'), accion: 'agregar', cantidad });
    await empleado.enviar('/ventas/cobrar', { id_sucursal: sucursal, canal: 'MOSTRADOR', id_medio_pago: debito });
    const { rows: [v] } = await consultar('SELECT max(id_venta) AS id FROM ventas');
    await consultar("UPDATE ventas SET fecha_hora = (current_date - 8) + $2::time WHERE id_venta = $1", [v.id, hora]);
    const { rows: [t] } = await consultar('SELECT total FROM ventas_totales WHERE id_venta = $1', [v.id]);
    return Number(t.total);
  }
  totalDelPico = await venderA(3, '21:30');
  await venderA(1, '15:10');

  dueno = new Navegador(sistema.base);
  await dueno.entrar('dueno');
  await dueno.enviar('/sucursal', { id_sucursal: sucursal });
  html = desescapar((await dueno.abrir('/')).html);
});
after(() => sistema.apagar());

describe('Gráficos del Inicio', () => {
  test('ayer se compara con el mismo día de la semana anterior', async () => {
    // Las barras van de hace 13 dias a hoy: ayer es la anteultima.
    const barras = [...html.matchAll(/data-detalle-texto="([^"]*)"/g)].map((m) => m[1]);
    const dias = barras.filter((t) => / en \d+ ventas?\. /.test(t));
    assert.equal(dias.length, 14);
    const ayer = dias[12];
    assert.match(ayer, /^\$0 en 0 ventas\. -100 % contra el mismo día de la semana anterior \(/);
    // Hace 8 dias se vendieron las dos ventas: el anterior de ayer es su suma.
    const { rows: [s] } = await consultar(
      "SELECT sum(total) AS t FROM ventas_totales WHERE fecha_hora::date = current_date - 8 AND tipo_venta = 'MINORISTA'"
    );
    assert.ok(ayer.endsWith('(' + pesos(Number(s.t)) + ').'), ayer);
    // Y cada barra lleva la de la semana anterior al lado.
    assert.equal([...html.matchAll(/class="barra-columna con-anterior"/g)].length, 14);
  });

  test('las horas pico son un mapa de calor que marca el pico', async () => {
    const dia = hace8.toLocaleDateString('es-AR', { weekday: 'long' });
    assert.match(html, new RegExp('El momento de más venta es el <strong>' + dia + ' de 21 a 22 h</strong>\\s*\\('
      + pesos(totalDelPico / 4).replace('$', '\\$') + ' en promedio\\)'));
    const pico = [...html.matchAll(/<span class="celda calor-(\d)( pico)?"\s*data-detalle-titulo="([^"]+)"/g)];
    // 7 dias por las horas de 15 a 21 (de la primera a la ultima con ventas).
    assert.equal(pico.length, 7 * 7);
    const marcadas = pico.filter((m) => m[2]);
    assert.equal(marcadas.length, 1);
    assert.equal(marcadas[0][1], '6');
    assert.equal(marcadas[0][3], dia.charAt(0).toUpperCase() + dia.slice(1) + ', de 21 a 22 h');
    // Las horas sin ventas quedan en el tono mas claro.
    assert.ok(pico.some((m) => m[1] === '0'));
  });

  test('cómo pagan y por dónde compran son barras partidas que suman 100 %', async () => {
    const leyendas = [...html.matchAll(/<ul class="leyenda-partida">([\s\S]*?)<\/ul>/g)];
    assert.equal(leyendas.length, 2);
    for (const [, lista] of leyendas) {
      const porcentajes = [...lista.matchAll(/class="valor">(\d+) %/g)].map((m) => Number(m[1]));
      assert.ok(porcentajes.length > 0);
      // Redondeados: pueden sumar 99 o 101.
      const suma = porcentajes.reduce((a, b) => a + b, 0);
      assert.ok(suma >= 98 && suma <= 102, 'suman ' + suma);
    }
    // El color de cada medio es fijo: Débito es el segundo medio de la lista.
    assert.match(html, /<li><i class="serie-2"><\/i><span>Débito<\/span>/);
  });
});
