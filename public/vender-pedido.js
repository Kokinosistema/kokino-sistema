'use strict';

// Vender sin recargar la pagina (2026-10-07). Cada toque que cambia el pedido
// (sumar un producto, -, +, Quitar, vaciar) se manda al servidor y vuelve
// solo el panel del pedido, que se reemplaza en el lugar. La pantalla no
// salta y el empleado sigue tocando.
//
//   - Los toques se mandan de a uno y en orden: dos al mismo tiempo podrian
//     pisarse en la sesion y perder un producto.
//   - Lo que ya se eligio para cobrar (canal, medio, montos) se conserva al
//     reemplazar el panel.
//   - Si algo falla (se corto la conexion, se cerro la sesion), se manda el
//     formulario como siempre y la pagina se recarga: nunca queda a medias.
(function () {
  var panel = document.querySelector('aside.pedido');
  if (!panel || !window.fetch) return;
  var cola = Promise.resolve();

  function guardarEleccion() {
    var form = panel.querySelector('form[action="/ventas/cobrar"]');
    if (!form) return null;
    var datos = {};
    form.querySelectorAll('input[type=radio]:checked').forEach(function (r) { datos['radio:' + r.name] = r.value; });
    form.querySelectorAll('input.dinero').forEach(function (c) { if (c.value) datos['monto:' + c.name] = c.value; });
    return datos;
  }

  function restaurarEleccion(datos) {
    var form = panel.querySelector('form[action="/ventas/cobrar"]');
    if (!form || !datos) return;
    Object.keys(datos).forEach(function (clave) {
      var partes = clave.split(':');
      if (partes[0] === 'radio') {
        var r = form.querySelector('input[type=radio][name="' + partes[1] + '"][value="' + datos[clave] + '"]');
        if (r) r.checked = true;
      } else {
        var c = form.querySelector('input[name="' + partes[1] + '"]');
        if (c) c.value = datos[clave];
      }
    });
  }

  // El cartelito "N en el pedido" de cada tarjeta.
  function marcarTarjetas(enPedido) {
    document.querySelectorAll('form.producto').forEach(function (f) {
      var id = f.querySelector('input[name=id_producto]').value;
      var boton = f.querySelector('.tarjeta-producto');
      var marca = boton.querySelector('.en-pedido');
      var n = enPedido[id];
      if (n) {
        if (!marca) { marca = document.createElement('span'); marca.className = 'en-pedido'; boton.appendChild(marca); }
        marca.textContent = n + ' en el pedido';
      } else if (marca) {
        marca.remove();
      }
    });
  }

  function enviar(form, boton) {
    var datos = new URLSearchParams(new FormData(form));
    if (boton && boton.name) datos.set(boton.name, boton.value);
    if (boton) boton.classList.add('tocado');
    cola = cola.then(function () {
      return fetch(form.action, {
        method: 'POST',
        body: datos,
        headers: { 'X-Kokino-Parcial': 'pedido' },
        credentials: 'same-origin',
      }).then(function (r) {
        if (!r.ok || (r.headers.get('content-type') || '').indexOf('application/json') === -1) throw new Error('respuesta inesperada');
        return r.json();
      }).then(function (respuesta) {
        var eleccion = guardarEleccion();
        panel.innerHTML = respuesta.html;
        restaurarEleccion(eleccion);
        if (window.iniciarPagoVarios) window.iniciarPagoVarios();
        if (window.iniciarVuelto) window.iniciarVuelto();
        marcarTarjetas(respuesta.enPedido);
        if (boton) setTimeout(function () { boton.classList.remove('tocado'); }, 150);
      }).catch(function () {
        // Sin conexion o con la sesion vencida: como siempre, recargando.
        if (boton && boton.name) {
          var oculto = document.createElement('input');
          oculto.type = 'hidden'; oculto.name = boton.name; oculto.value = boton.value;
          form.appendChild(oculto);
        }
        HTMLFormElement.prototype.submit.call(form);
      });
    });
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.getAttribute('action') !== '/ventas/pedido') return;
    e.preventDefault();
    enviar(form, e.submitter);
  });
})();
