'use strict';

// Ojito al costado de cada campo de contrasena, para ver lo que se escribio
// (pedido de la usuaria el 2026-10-10): en el mostrador se tipea apurado y
// con los puntos no se nota el error hasta que el sistema rechaza la entrada.
// Tocarlo muestra la contrasena y tocarlo otra vez la vuelve a tapar. Al
// enviar el formulario se tapa de nuevo, para que no quede a la vista si la
// pantalla vuelve con un error.
(function () {
  var OJO = '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>';
  var OJO_TACHADO = OJO + '<path d="M4 4l16 16"/>';

  function dibujar(boton, visible) {
    boton.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + (visible ? OJO_TACHADO : OJO) + '</svg>';
    var texto = visible ? 'Ocultar la contraseña' : 'Mostrar la contraseña';
    boton.setAttribute('aria-label', texto);
    boton.title = texto;
    boton.setAttribute('aria-pressed', visible ? 'true' : 'false');
  }

  document.querySelectorAll('input[type="password"]').forEach(function (campo) {
    var envoltorio = document.createElement('div');
    envoltorio.className = 'campo-contrasena';
    campo.parentNode.insertBefore(envoltorio, campo);
    envoltorio.appendChild(campo);

    var boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'ver-contrasena';
    envoltorio.appendChild(boton);
    dibujar(boton, false);

    boton.addEventListener('click', function () {
      var visible = campo.type === 'password';
      campo.type = visible ? 'text' : 'password';
      dibujar(boton, visible);
      campo.focus();
    });

    if (campo.form) {
      campo.form.addEventListener('submit', function () {
        campo.type = 'password';
        dibujar(boton, false);
      });
    }
  });
})();
