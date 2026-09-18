'use strict';

// Deja pasar solo a quien inicio sesion. Se aplica a todo menos al login:
// en un sistema de caja no hay nada publico, porque cada operacion tiene que
// quedar atada a quien la hizo.
function exigirLogin(req, res, siguiente) {
  if (!req.session.usuario) {
    // Se recuerda a donde queria ir para devolverlo ahi despues de entrar. Sin
    // esto, una sesion vencida lo deja siempre en la pantalla de inicio y
    // tiene que volver a buscar lo que estaba haciendo.
    req.session.destino = req.originalUrl;
    return res.redirect('/login');
  }
  siguiente();
}

// Deja pasar solo a los roles indicados. Se usa para las pantallas que son de
// los duenos: configuracion, ventas mayoristas y reportes de las dos
// sucursales juntas.
//
// Es a proposito una funcion que devuelve otra: asi cada ruta declara que rol
// necesita, en vez de repetir el mismo if adentro de cada una.
function exigirRol(...rolesPermitidos) {
  return function (req, res, siguiente) {
    if (!rolesPermitidos.includes(req.session.usuario.rol)) {
      return res.status(403).render('error', {
        titulo: 'No tenes permiso',
        mensaje: 'Esta pantalla es solo para los duenos del negocio.',
      });
    }
    siguiente();
  };
}

// Pone al usuario logueado a mano de todas las vistas, para no tener que
// pasarlo explicitamente en cada render.
function exponerUsuario(req, res, siguiente) {
  res.locals.usuario = req.session.usuario || null;
  siguiente();
}

// Mensajes de una sola vez, del estilo "se agrego a tal proveedor".
//
// Despues de guardar se redirige en vez de mostrar la pantalla directamente,
// asi refrescar no vuelve a guardar lo mismo. Pero al redirigir se pierde todo
// lo que el servidor sabia, incluido el aviso, asi que viaja en la sesion y se
// borra apenas se lee: si quedara guardado, apareceria de nuevo en la pantalla
// siguiente sin que nadie hiciera nada.
function exponerAviso(req, res, siguiente) {
  res.locals.aviso = req.session.aviso || null;
  delete req.session.aviso;
  siguiente();
}

module.exports = { exigirLogin, exigirRol, exponerUsuario, exponerAviso };
