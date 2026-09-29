'use strict';

// Corre en el navegador por una razon concreta:
// una receta tiene una cantidad de ingredientes que no se sabe de antemano, y
// obligar a guardar para agregar el siguiente haria insoportable cargar una
// formula de quince renglones.
//
// Todo lo demas sigue pasando en el servidor. Esto solo agrega y saca
// renglones; validar y guardar es del servidor, que es el unico que no se
// puede saltear.
(function () {
  var cuerpo = document.getElementById('cuerpo-ingredientes');
  var agregar = document.getElementById('agregar-ingrediente');
  if (!cuerpo || !agregar) return;

  function vaciar(renglon) {
    renglon.querySelectorAll('select, input').forEach(function (campo) {
      if (campo.tagName === 'INPUT') campo.value = '';
      else campo.selectedIndex = 0;
    });
    return renglon;
  }

  agregar.addEventListener('click', function () {
    var ultimo = cuerpo.querySelector('.renglon:last-child');
    var nuevo = vaciar(ultimo.cloneNode(true));
    cuerpo.appendChild(nuevo);
    nuevo.querySelector('select').focus();
  });

  // Se escucha en el cuerpo de la tabla y no en cada boton, asi los renglones
  // agregados despues tambien funcionan sin volver a engancharles nada.
  cuerpo.addEventListener('click', function (evento) {
    if (!evento.target.classList.contains('quitar')) return;
    // Nunca dejar la tabla sin ningun renglon: sin ninguno no habria donde
    // escribir y el boton de agregar no tendria que clonar.
    if (cuerpo.querySelectorAll('.renglon').length === 1) {
      vaciar(cuerpo.querySelector('.renglon'));
      return;
    }
    evento.target.closest('.renglon').remove();
  });
})();
