'use strict';

// Campos de CUIT (<input class="cuit">): mientras se escribe acepta solo
// numeros, pone los guiones (XX-XXXXXXXX-X) y no deja pasar de 11 numeros.
// Debajo del campo muestra un cartel si el CUIT no puede ser valido.
//
// Es la misma regla que aplica el servidor en src/cuit.js, que es el que
// decide al guardar: esto es para enterarse antes, mientras se escribe.
(function () {
  var PREFIJOS = ['20', '23', '24', '27', '30', '33', '34'];

  function formatear(digitos) {
    if (digitos.length <= 2) return digitos;
    if (digitos.length <= 10) return digitos.slice(0, 2) + '-' + digitos.slice(2);
    return digitos.slice(0, 2) + '-' + digitos.slice(2, 10) + '-' + digitos.slice(10);
  }

  function verificadorCierra(d) {
    var pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    var suma = 0;
    for (var i = 0; i < 10; i += 1) suma += pesos[i] * Number(d[i]);
    var resto = suma % 11;
    var verificador = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
    return verificador === Number(d[10]);
  }

  // Que decir segun lo escrito. Mientras se esta escribiendo solo se avisa lo
  // que ya se sabe que esta mal (como empieza); que faltan numeros se avisa
  // recien al salir del campo, para no retar a nadie a mitad de camino.
  function problema(digitos, terminado) {
    if (digitos.length >= 2 && PREFIJOS.indexOf(digitos.slice(0, 2)) === -1) {
      return 'Error: un CUIT empieza con 20, 23, 24, 27, 30, 33 o 34.';
    }
    if (digitos.length === 11 && !verificadorCierra(digitos)) {
      return 'Error: ese CUIT no existe, el último número no cierra. Revisá que esté bien copiado.';
    }
    if (terminado && digitos.length > 0 && digitos.length < 11) {
      return 'Error: al CUIT le faltan números (tiene ' + digitos.length + ' de 11).';
    }
    return '';
  }

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

  function mostrar(campo, texto) {
    var cartel = cartelDe(campo);
    cartel.textContent = texto;
    cartel.hidden = texto === '';
    campo.classList.toggle('con-error', texto !== '');
  }

  function aplicar(campo, terminado) {
    var antes = campo.value;
    var cursor = campo.selectionStart === null ? antes.length : campo.selectionStart;
    var digitosAntesDelCursor = antes.slice(0, cursor).replace(/\D/g, '').length;
    var tieneLetras = /[^\d\s-]/.test(antes);
    var digitos = antes.replace(/\D/g, '').slice(0, 11);

    campo.value = formatear(digitos);
    // El cursor vuelve a quedar despues del mismo numero en que estaba.
    var posicion = campo.value.length;
    for (var i = 0, n = 0; i < campo.value.length; i += 1) {
      if (n === digitosAntesDelCursor) { posicion = i; break; }
      if (/\d/.test(campo.value[i])) n += 1;
    }
    if (document.activeElement === campo) campo.setSelectionRange(posicion, posicion);

    mostrar(campo, tieneLetras ? 'Error: el CUIT solo lleva números.' : problema(digitos, terminado));
  }

  document.addEventListener('input', function (e) {
    if (e.target.classList && e.target.classList.contains('cuit')) aplicar(e.target, false);
  });
  document.addEventListener('focusout', function (e) {
    if (e.target.classList && e.target.classList.contains('cuit')) aplicar(e.target, true);
  });
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('input.cuit').forEach(function (campo) {
      if (campo.value) aplicar(campo, true);
    });
  });
})();
