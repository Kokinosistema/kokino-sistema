'use strict';

// Campos que aceptan solo numeros (<input class="solo-numeros">), como el
// telefono o los dias para pagar. Si se tipea o se pega otra cosa (letras,
// espacios, guiones, una coma), no entra y aparece un cartel debajo del
// campo hasta el siguiente numero. El largo lo pone el maxlength del campo,
// y el texto del cartel, su data-mensaje.
//
// El servidor aplica la misma regla y es el que decide al guardar.
(function () {
  function cartelDe(campo) {
    var cartel = campo.nextElementSibling;
    if (!cartel || !cartel.classList.contains('error-campo')) {
      cartel = document.createElement('p');
      cartel.className = 'error-campo';
      cartel.setAttribute('role', 'alert');
      cartel.hidden = true;
      campo.insertAdjacentElement('afterend', cartel);
    }
    return cartel;
  }

  document.addEventListener('input', function (e) {
    var campo = e.target;
    if (!campo.classList || !campo.classList.contains('solo-numeros')) return;
    var antes = campo.value;
    var cursor = campo.selectionStart === null ? antes.length : campo.selectionStart;
    var largo = campo.maxLength > 0 ? campo.maxLength : antes.length;
    var limpio = antes.replace(/\D/g, '').slice(0, largo);
    var cartel = cartelDe(campo);
    if (limpio !== antes) {
      // El cursor queda despues del mismo numero en que estaba.
      var numerosAntes = antes.slice(0, cursor).replace(/\D/g, '').length;
      campo.value = limpio;
      campo.setSelectionRange(numerosAntes, numerosAntes);
      if (/\D/.test(antes)) {
        cartel.textContent = 'Error: ' + (campo.dataset.mensaje || 'este campo solo lleva números.');
        cartel.hidden = false;
        campo.classList.add('con-error');
      }
    }
    if (campo.value === '') ocultar(campo);
  });

  // El cartel queda a la vista hasta salir del campo, no hasta el siguiente
  // numero: si alguien escribe "15,5", la coma no entra y queda 155, y eso
  // tiene que verse antes de guardar.
  function ocultar(campo) {
    var cartel = campo.nextElementSibling;
    if (cartel && cartel.classList.contains('error-campo')) cartel.hidden = true;
    campo.classList.remove('con-error');
  }
  document.addEventListener('focusout', function (e) {
    if (e.target.classList && e.target.classList.contains('solo-numeros')) ocultar(e.target);
  });
})();
