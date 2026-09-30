'use strict';

// Campos de telefono (<input class="telefono">): aceptan solo numeros. Si se
// tipea o se pega otra cosa (letras, espacios, guiones), no entra y aparece
// un cartel debajo del campo hasta el siguiente numero.
//
// El servidor aplica la misma regla (src/telefono.js) y es el que decide.
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
    if (!campo.classList || !campo.classList.contains('telefono')) return;
    var antes = campo.value;
    var cursor = campo.selectionStart === null ? antes.length : campo.selectionStart;
    var limpio = antes.replace(/\D/g, '').slice(0, 15);
    var cartel = cartelDe(campo);
    if (limpio !== antes) {
      // El cursor queda despues del mismo numero en que estaba.
      var numerosAntes = antes.slice(0, cursor).replace(/\D/g, '').length;
      campo.value = limpio;
      campo.setSelectionRange(numerosAntes, numerosAntes);
      if (/\D/.test(antes)) {
        cartel.textContent = 'Error: el teléfono solo lleva números.';
        cartel.hidden = false;
        campo.classList.add('con-error');
        return;
      }
    }
    cartel.hidden = true;
    campo.classList.remove('con-error');
  });
})();
