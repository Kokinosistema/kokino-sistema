'use strict';

// Campos de plata: mientras se escribe, se muestra en formato argentino.
// Se tipea 300000 y se ve $300.000; se tipea 300000,15 y se ve $300.000,15.
// El punto de los miles lo pone el campo solo; los centavos van despues de
// la coma, dos como mucho.
//
// Sirve para cualquier <input class="dinero">, sin engancharlo uno por uno:
// se escucha en todo el documento. Lo que se guarda lo decide el servidor,
// que vuelve a leer y validar el monto (src/dinero.js): esto es comodidad,
// no control.
(function () {
  // Lo que importa del texto: los digitos y la primera coma. El resto (el
  // signo, los puntos de miles) lo vuelve a poner el formato.
  function limpiar(texto) {
    var entero = '';
    var decimales = null;
    for (var i = 0; i < texto.length; i += 1) {
      var c = texto[i];
      if (c >= '0' && c <= '9') {
        if (decimales === null) entero += c;
        else if (decimales.length < 2) decimales += c;
      } else if (c === ',' && decimales === null) {
        decimales = '';
      }
    }
    entero = entero.replace(/^0+(?=\d)/, '');
    if (entero === '' && decimales !== null) entero = '0';
    return { entero: entero, decimales: decimales };
  }

  function formatear(texto) {
    var partes = limpiar(texto);
    if (partes.entero === '') return '';
    return '$' + partes.entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
      + (partes.decimales !== null ? ',' + partes.decimales : '');
  }

  // Cuantos caracteres "que importan" (digitos y coma) hay antes de una
  // posicion: sirve para dejar el cursor donde estaba despues de formatear.
  function significativos(texto, hasta) {
    var n = 0;
    for (var i = 0; i < hasta; i += 1) if (/[\d,]/.test(texto[i])) n += 1;
    return n;
  }

  function aplicar(campo) {
    var antes = campo.value;
    var cursor = campo.selectionStart === null ? antes.length : campo.selectionStart;
    var cuenta = significativos(antes, cursor);
    var despues = formatear(antes);
    if (despues === antes) return;
    campo.value = despues;
    var posicion = despues.length;
    for (var i = 0, n = 0; i < despues.length; i += 1) {
      if (n === cuenta) { posicion = i; break; }
      if (/[\d,]/.test(despues[i])) n += 1;
      if (n === cuenta) { posicion = i + 1; break; }
    }
    if (document.activeElement === campo) campo.setSelectionRange(posicion, posicion);
  }

  // Si se tipea o se pega algo que no es un monto (una letra), no entra y se
  // avisa debajo del campo hasta salir de el, igual que en los otros campos
  // de solo numeros.
  function avisar(campo, mostrar) {
    var cartel = campo.nextElementSibling;
    if (!cartel || !cartel.classList.contains('error-campo')) {
      if (!mostrar) return;
      cartel = document.createElement('p');
      cartel.className = 'error-campo';
      cartel.setAttribute('role', 'alert');
      campo.insertAdjacentElement('afterend', cartel);
    }
    cartel.textContent = 'Error: el monto solo lleva números; la coma separa los centavos.';
    cartel.hidden = !mostrar;
    campo.classList.toggle('con-error', mostrar);
  }

  document.addEventListener('focusout', function (evento) {
    if (evento.target.classList && evento.target.classList.contains('dinero')) avisar(evento.target, false);
  });

  document.addEventListener('input', function (evento) {
    var campo = evento.target;
    if (!campo.classList || !campo.classList.contains('dinero')) return;
    if (/[^\d.,$\s]/.test(campo.value)) avisar(campo, true);
    // El punto del teclado numerico se toma como coma: quien lo aprieta
    // quiere poner centavos, porque los puntos de miles los pone el campo.
    if (evento.data === '.' && campo.value.indexOf(',') === -1) {
      var p = campo.selectionStart;
      campo.value = campo.value.slice(0, p - 1) + ',' + campo.value.slice(p);
      campo.setSelectionRange(p, p);
    }
    aplicar(campo);
  });

  // Lo que vuelve escrito del servidor (por ejemplo, al volver con un error)
  // tambien se muestra formateado. Los montos que vienen de la base los manda
  // el servidor ya en formato argentino, asi que aca todo punto es de miles.
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('input.dinero').forEach(function (campo) {
      if (campo.value) campo.value = formatear(campo.value);
    });
  });

  // Para las cuentas que hacen otras pantallas en el navegador, como el
  // "cuanto falta" del pago con varios medios.
  window.dineroKokino = {
    centavos: function (texto) {
      var partes = limpiar(texto || '');
      if (partes.entero === '') return 0;
      return Number(partes.entero) * 100 + Number(((partes.decimales || '') + '00').slice(0, 2));
    },
    pesos: function (centavos) {
      var absoluto = Math.abs(Math.round(centavos));
      var enteros = String(Math.floor(absoluto / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      var resto = absoluto % 100;
      return (centavos < 0 ? '-' : '') + '$' + enteros + (resto ? ',' + String(resto).padStart(2, '0') : '');
    },
  };
})();
