'use strict';

// Vender con el teclado (pedido de la usuaria el 2026-10-15: la PC del
// mostrador tiene teclado y mouse). Una venta tipica se hace sin soltarlo:
//
//   - El buscador queda listo al entrar y despues de cada cobro.
//   - En el buscador: flechas para recorrer los resultados, Enter suma el
//     marcado (o el primero, si no se marco ninguno) y Esc borra.
//   - "/" vuelve al buscador desde cualquier lado, salvo escribiendo en otro
//     campo.
//   - F9 va a cobrar: a "Con que pago". Despues, Tab y Enter, como siempre.
//
// Todo lo que se hace con el mouse sigue igual: esto solo agrega atajos.
// Sumar al pedido manda el mismo formulario que tocar la tarjeta, asi que
// pasa por vender-pedido.js como cualquier toque.
(function () {
  var campo = document.getElementById('buscar-todo') || document.getElementById('buscar-producto');
  if (!campo) return;
  // Con la busqueda general, los resultados estan en su propio bloque; en
  // una categoria, son sus tarjetas.
  var zona = campo.id === 'buscar-todo'
    ? document.getElementById('resultados-busqueda')
    : document.querySelector('.catalogo-venta .productos');
  var marcada = -1;

  function visibles() {
    if (!zona || zona.hidden) return [];
    return Array.prototype.filter.call(zona.querySelectorAll('form.producto'), function (f) { return !f.hidden; });
  }

  function desmarcar() {
    marcada = -1;
    Array.prototype.forEach.call(document.querySelectorAll('.tarjeta-producto.marcada'), function (b) { b.classList.remove('marcada'); });
  }

  function marcar(indice) {
    var tarjetas = visibles();
    desmarcar();
    if (tarjetas.length === 0) return;
    marcada = Math.max(0, Math.min(indice, tarjetas.length - 1));
    var boton = tarjetas[marcada].querySelector('.tarjeta-producto');
    boton.classList.add('marcada');
    boton.scrollIntoView({ block: 'nearest' });
  }

  function sumar() {
    var tarjetas = visibles();
    if (tarjetas.length === 0) return;
    // Sin nada marcado ni escrito, Enter no suma nada: seria sumar al azar
    // la primera tarjeta de la categoria.
    if (marcada < 0 && campo.value.trim() === '') return;
    var form = tarjetas[marcada >= 0 ? marcada : 0];
    var boton = form.querySelector('.tarjeta-producto');
    // requestSubmit con el boton: el mismo envio que un toque en la tarjeta.
    form.requestSubmit(boton);
  }

  campo.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); marcar(marcada + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(marcada - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); sumar(); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      campo.value = '';
      campo.dispatchEvent(new Event('input'));
    }
  });
  // Al escribir cambian los resultados: la marca vuelve a empezar.
  campo.addEventListener('input', desmarcar);

  function escribiendoEnOtroCampo() {
    var a = document.activeElement;
    if (!a || a === campo) return false;
    return a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !/^(radio|checkbox|button|submit)$/.test(a.type);
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === '/' && !escribiendoEnOtroCampo() && document.activeElement !== campo) {
      e.preventDefault();
      campo.focus();
      campo.select();
    } else if (e.key === 'F9') {
      e.preventDefault();
      var medio = document.querySelector('#medio-pago input[name="id_medio_pago"]:checked')
        || document.querySelector('#medio-pago input[name="id_medio_pago"]');
      if (medio) medio.focus();
    }
  });

  // Listo para buscar al entrar, salvo que la pantalla venga con errores al
  // cobrar (ahi lo que hay que mirar es el pedido) o que sea una pantalla
  // tactil, donde abriria el teclado de la pantalla y taparia media pagina.
  var conMouse = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  if (conMouse && !document.querySelector('.errores')) {
    campo.focus();
    // El cursor al final, si volvio con una busqueda escrita.
    var n = campo.value.length;
    campo.setSelectionRange(n, n);
  }
})();
