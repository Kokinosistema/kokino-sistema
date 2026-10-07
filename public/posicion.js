'use strict';

// Que la pagina no vuelva arriba despues de tocar un boton (pedido de la
// usuaria el 2026-10-07). Casi todos los botones envian un formulario y el
// servidor vuelve a mostrar la misma pantalla; sin esto el navegador la
// muestra desde arriba.
//
//   - Al enviar un formulario se guarda en que pantalla y a que altura se
//     estaba (sessionStorage: solo de esta pestana).
//   - Al cargar la pagina, si es la misma pantalla y paso poco tiempo, se
//     vuelve a esa altura.
//   - Si la pagina trae un error, se lleva el error a la vista en vez de
//     volver a la altura: el error es lo que hay que leer.
//   - El aviso de "se guardo" esta arriba de todo: si se vuelve a una altura
//     donde no se ve, aparece flotando unos segundos.
//
// Es comodidad: si el navegador no deja guardar nada, la pagina funciona igual.
(function () {
  var CLAVE = 'kokino-posicion';
  var VIGENCIA_MS = 20000;

  document.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    try {
      sessionStorage.setItem(CLAVE, JSON.stringify({ ruta: location.pathname, y: window.scrollY, t: Date.now() }));
    } catch (error) { /* sin almacenamiento: no pasa nada */ }
  });

  function restaurar() {
    var guardado = null;
    try {
      guardado = JSON.parse(sessionStorage.getItem(CLAVE) || 'null');
      sessionStorage.removeItem(CLAVE);
    } catch (error) { return; }
    if (!guardado || guardado.ruta !== location.pathname || Date.now() - guardado.t > VIGENCIA_MS) return;

    var error = document.querySelector('.errores');
    if (error) {
      error.scrollIntoView({ block: 'center' });
      return;
    }
    window.scrollTo(0, guardado.y);
    var aviso = document.querySelector('.aviso');
    if (aviso && guardado.y > 80) {
      aviso.classList.add('aviso-flotante');
      setTimeout(function () { aviso.classList.add('aviso-saliendo'); }, 4500);
      setTimeout(function () { aviso.classList.remove('aviso-flotante', 'aviso-saliendo'); }, 5200);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restaurar);
  else restaurar();
})();
