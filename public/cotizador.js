'use strict';

// Cotizador mayorista: las reglas para calcular una cotizacion de tachos,
// traidas del Sistema Rody (src/cotizador/cotizador.ts) el 2026-10-22. No
// toca la base ni la pantalla: recibe la lista de precios del cliente y lo
// que se lleva, y devuelve cada renglon con su precio y el total.
//
// Es el mismo archivo en los dos lados. El navegador lo carga con <script> y
// lo usa para mostrar el total mientras se arma la cotizacion; el servidor lo
// carga con require y recalcula todo antes de guardar, porque lo que manda el
// navegador se puede tocar. Tenerlo una sola vez evita que el total que el
// dueno manda por WhatsApp y el que se guarda lleguen a ser distintos.
//
// Datos de entrada:
//   lista: { nombre, incluyeFamiliar, incluyeArtesanal, precios: { idSabor: precio } }
//          Un sabor que no esta en precios no tiene precio en esa lista.
//   renglones: [{ idSabor, sabor, linea: 'FAMILIAR' | 'ARTESANAL', tachos }]
//   precioEnvase: lo que vale el envase que el cliente compra.
//   compraEnvases: true, false, o null si todavia no se respondio.
//   envasesComprados: cuantos compra (nunca mas que los tachos).
(function (exportar) {
  var LINEAS = { FAMILIAR: 'Familiar', ARTESANAL: 'Artesanal' };

  // Las cuentas se hacen en centavos enteros, como en src/dinero.js.
  function centavos(valor) {
    return Math.round(Number(valor) * 100);
  }

  function incluye(lista, linea) {
    return linea === 'FAMILIAR' ? lista.incluyeFamiliar : lista.incluyeArtesanal;
  }

  // Un renglon queda 'no-disponible' si la lista no incluye su linea (en
  // Terminal, un artesanal), y 'sin-precio' si el sabor no tiene precio en la
  // lista. En los dos casos queda fuera del total y la cotizacion es parcial.
  function calcularRenglon(lista, r) {
    if (!incluye(lista, r.linea)) {
      return Object.assign({}, r, { estado: 'no-disponible', precioUnitario: null, subtotal: null });
    }
    var precio = lista.precios[r.idSabor];
    if (precio === undefined || precio === null) {
      return Object.assign({}, r, { estado: 'sin-precio', precioUnitario: null, subtotal: null });
    }
    return Object.assign({}, r, {
      estado: 'ok',
      precioUnitario: centavos(precio) / 100,
      subtotal: (centavos(precio) * r.tachos) / 100,
    });
  }

  function calcularCotizacion(d) {
    var renglones = d.renglones.map(function (r) { return calcularRenglon(d.lista, r); });
    var tachos = renglones.reduce(function (suma, r) { return suma + r.tachos; }, 0);
    // Un envase por tacho: no se pueden comprar mas envases que tachos.
    var envasesComprados = d.compraEnvases ? Math.max(0, Math.min(d.envasesComprados, tachos)) : 0;
    var envasesEnCentavos = envasesComprados * centavos(d.precioEnvase);
    var heladoEnCentavos = renglones.reduce(function (suma, r) { return suma + (r.subtotal === null ? 0 : centavos(r.subtotal)); }, 0);
    return {
      renglones: renglones,
      tachos: tachos,
      envasesComprados: envasesComprados,
      envasesPrestados: tachos - envasesComprados,
      totalEnvases: envasesEnCentavos / 100,
      total: (heladoEnCentavos + envasesEnCentavos) / 100,
      esParcial: renglones.some(function (r) { return r.estado !== 'ok'; }),
    };
  }

  // Igual que pesos() de src/dinero.js: $41.000, o $41.000,50 si tiene
  // centavos. Esta repetido porque aquel no llega al navegador; una prueba
  // controla que los dos den lo mismo.
  function pesos(valor) {
    var c = centavos(valor);
    if (!isFinite(c)) return '';
    var absoluto = Math.abs(c);
    var enteros = String(Math.floor(absoluto / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var resto = absoluto % 100;
    return (c < 0 ? '-' : '') + '$' + enteros + (resto ? ',' + String(resto).padStart(2, '0') : '');
  }

  // dd/mm/aaaa.
  function formatearFecha(fecha) {
    function dos(n) { return String(n).padStart(2, '0'); }
    return dos(fecha.getDate()) + '/' + dos(fecha.getMonth() + 1) + '/' + fecha.getFullYear();
  }

  // Texto para mandar por WhatsApp: lo que va entre asteriscos se ve en negrita.
  function textoWhatsApp(c, o) {
    var lineas = ['*' + o.heladeria + '*', 'Cotización para: ' + o.cliente, 'Fecha: ' + formatearFecha(o.fecha), ''];
    c.renglones.forEach(function (r) {
      var importe = r.subtotal !== null ? pesos(r.subtotal) : r.estado === 'sin-precio' ? 'precio a confirmar' : 'no disponible';
      lineas.push(r.tachos + ' × ' + r.sabor + ' (' + LINEAS[r.linea] + '): ' + importe);
    });
    if (c.envasesComprados) lineas.push(c.envasesComprados + ' × Envase: ' + pesos(c.totalEnvases));
    lineas.push('', '*Total: ' + pesos(c.total) + '*');
    if (c.envasesPrestados) lineas.push('', 'Envases prestados a devolver: ' + c.envasesPrestados);
    return lineas.join('\n');
  }

  exportar({ calcularCotizacion: calcularCotizacion, textoWhatsApp: textoWhatsApp, pesos: pesos, formatearFecha: formatearFecha });
})(function (api) {
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.cotizador = api;
});
