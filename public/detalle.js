'use strict';

// El recuadro con el detalle de una barra o un casillero de los graficos
// (2026-10-16). Reemplaza al title del navegador, que tarda en aparecer y no
// anda al tocar en una tablet o un celular.
//
// Cualquier elemento con data-detalle-titulo (y opcionalmente
// data-detalle-texto) lo muestra: al pasar el mouse, al tocarlo y al llegar
// con el teclado (Tab). Un solo recuadro para toda la pagina.
(function () {
  var caja = document.createElement('div');
  caja.className = 'detalle-grafico';
  caja.hidden = true;
  caja.setAttribute('role', 'status');
  document.body.appendChild(caja);
  var actual = null;

  function mostrar(objetivo, x, y) {
    actual = objetivo;
    caja.textContent = '';
    var titulo = document.createElement('strong');
    titulo.textContent = objetivo.getAttribute('data-detalle-titulo');
    caja.appendChild(titulo);
    var texto = objetivo.getAttribute('data-detalle-texto');
    if (texto) caja.appendChild(document.createTextNode(texto));
    caja.hidden = false;
    // Arriba del puntero; si no entra, abajo. Nunca afuera de la pantalla.
    var r = caja.getBoundingClientRect();
    caja.style.left = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8) + 'px';
    caja.style.top = (y - r.height - 12 < 8 ? y + 16 : y - r.height - 12) + 'px';
  }

  function ocultar() {
    caja.hidden = true;
    actual = null;
  }

  function buscar(evento) {
    return evento.target.closest ? evento.target.closest('[data-detalle-titulo]') : null;
  }

  document.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    var objetivo = buscar(e);
    if (objetivo) mostrar(objetivo, e.clientX, e.clientY);
    else if (actual) ocultar();
  });
  // Al tocar: el primer toque lo muestra, otro toque afuera (o en el mismo) lo cierra.
  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch') return;
    var objetivo = buscar(e);
    if (objetivo && objetivo !== actual) mostrar(objetivo, e.clientX, e.clientY);
    else ocultar();
  });
  document.addEventListener('focusin', function (e) {
    var objetivo = buscar(e);
    if (!objetivo) return;
    var r = objetivo.getBoundingClientRect();
    mostrar(objetivo, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', ocultar);
  window.addEventListener('scroll', function () { if (actual) ocultar(); }, { passive: true });
})();
