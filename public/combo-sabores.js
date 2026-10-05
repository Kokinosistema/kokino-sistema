'use strict';

// Lista de sabores con buscador, como la de Fabricacion y la de Envios:
// siempre se abre para abajo, la flecha la abre y la cierra, y escribir la
// despliega con lo que coincide (sin importar acentos ni mayusculas, y con
// cada palabra en cualquier orden). Se elige con un clic o con Enter.
//
// Uso: comboSabores(elementoCombo, { alElegir: function (opcion) {...},
// alEscribir: function () {...} }). Devuelve { limpiar, elegida }.
// Cada opcion es un <li class="combo-opcion"> con data-valor y data-nombre.
(function () {
  function normalizar(t) { return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  window.comboSabores = function (combo, avisos) {
    var texto = combo.querySelector('.combo-texto');
    var flecha = combo.querySelector('.combo-flecha');
    var lista = combo.querySelector('.combo-lista');
    var vacio = lista.querySelector('.combo-vacio');
    var opciones = Array.prototype.slice.call(lista.querySelectorAll('.combo-opcion'));
    var grupos = lista.querySelectorAll('.combo-grupo');
    var elegida = null;
    var activa = -1;

    function visibles() { return opciones.filter(function (o) { return !o.hidden; }); }

    function filtrar(consulta) {
      var palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
      opciones.forEach(function (o) {
        var nombre = normalizar(o.dataset.nombre);
        o.hidden = !palabras.every(function (p) { return nombre.indexOf(p) !== -1; });
      });
      // El titulo de un grupo (si la lista tiene) se ve solo si le queda
      // alguna opcion a la vista.
      grupos.forEach(function (g) {
        var sig = g.nextElementSibling, alguna = false;
        while (sig && !sig.classList.contains('combo-grupo')) {
          if (sig.classList.contains('combo-opcion') && !sig.hidden) alguna = true;
          sig = sig.nextElementSibling;
        }
        g.hidden = !alguna;
      });
      vacio.hidden = visibles().length > 0;
      marcar(visibles().length > 0 ? 0 : -1);
    }

    function marcar(i) {
      var v = visibles();
      opciones.forEach(function (o) { o.classList.remove('activa'); o.setAttribute('aria-selected', 'false'); });
      activa = i;
      if (i >= 0 && v[i]) {
        v[i].classList.add('activa');
        v[i].setAttribute('aria-selected', 'true');
        texto.setAttribute('aria-activedescendant', v[i].id);
        v[i].scrollIntoView({ block: 'nearest' });
      } else {
        texto.removeAttribute('aria-activedescendant');
      }
    }

    function abrir() { lista.hidden = false; combo.classList.add('abierto'); texto.setAttribute('aria-expanded', 'true'); }
    function cerrar() { lista.hidden = true; combo.classList.remove('abierto'); texto.setAttribute('aria-expanded', 'false'); }

    function elegir(o) {
      elegida = o;
      texto.value = o.dataset.nombre;
      cerrar();
      if (avisos.alElegir) avisos.alElegir(o);
    }

    flecha.addEventListener('mousedown', function (e) { e.preventDefault(); });
    flecha.addEventListener('click', function () {
      if (!lista.hidden) { cerrar(); return; }
      filtrar(elegida && texto.value === elegida.dataset.nombre ? '' : texto.value);
      abrir();
      texto.focus();
    });

    texto.addEventListener('focus', function () { texto.select(); });
    texto.addEventListener('input', function () {
      elegida = null;
      if (avisos.alEscribir) avisos.alEscribir();
      filtrar(texto.value);
      abrir();
    });
    texto.addEventListener('keydown', function (e) {
      var v = visibles();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (lista.hidden) { filtrar(elegida ? '' : texto.value); abrir(); } else marcar(Math.min(activa + 1, v.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!lista.hidden) marcar(Math.max(activa - 1, 0));
      } else if (e.key === 'Enter') {
        // Enter elige en vez de enviar el formulario.
        e.preventDefault();
        if (!lista.hidden && v[activa]) elegir(v[activa]);
        else if (elegida) { if (avisos.alElegir) avisos.alElegir(elegida); }
        else { filtrar(texto.value); if (visibles()[0]) elegir(visibles()[0]); }
      } else if (e.key === 'Escape') {
        cerrar();
      }
    });

    lista.addEventListener('mousedown', function (e) { e.preventDefault(); });
    lista.addEventListener('click', function (e) {
      var o = e.target.closest('.combo-opcion');
      if (o) elegir(o);
    });
    document.addEventListener('click', function (e) { if (!combo.contains(e.target)) cerrar(); });

    return {
      elegida: function () { return elegida; },
      limpiar: function () { elegida = null; texto.value = ''; cerrar(); },
    };
  };
})();
