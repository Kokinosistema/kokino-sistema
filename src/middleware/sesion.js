'use strict';

const { consultar } = require('../db');

// Deja pasar solo a quien inicio sesion. Se aplica a todo menos al login:
// en un sistema de caja no hay nada publico, porque cada operacion tiene que
// quedar atada a quien la hizo.
//
// Ademas vuelve a leer el rol y el estado de la cuenta en cada pedido, en vez
// de confiar en lo que se guardo al entrar. La diferencia importa: sin esto,
// quitarle el acceso a alguien o bajarle el rol no tendria efecto hasta que
// cerrara sesion, y la cookie dura 12 horas. Echar a alguien un sabado a la
// tarde lo dejaria operando hasta la noche.
//
// Es una consulta mas por pedido, pero busca por clave primaria y devuelve una
// fila: al lado de lo que cuesta pintar la pantalla, no se nota.
async function exigirLogin(req, res, siguiente) {
  if (!req.session.usuario) {
    // Se recuerda a donde queria ir para devolverlo ahi despues de entrar. Sin
    // esto, una sesion vencida lo deja siempre en la pantalla de inicio y
    // tiene que volver a buscar lo que estaba haciendo.
    req.session.destino = req.originalUrl;
    return res.redirect('/login');
  }

  try {
    const { rows } = await consultar(
      `SELECT u.username,
              r.nombre_rol            AS rol,
              e.nombre,
              e.apellido,
              e.id_sucursal_asignada,
              s.nombre                AS sucursal
         FROM usuarios u
         JOIN roles r     ON r.id_rol = u.id_rol
         JOIN empleados e ON e.id_empleado = u.id_empleado
         LEFT JOIN sucursales s ON s.id_sucursal = e.id_sucursal_asignada
        WHERE u.id_usuario = $1
          AND u.activo
          AND e.activo`,
      [req.session.usuario.id_usuario]
    );

    // La cuenta se desactivo, se borro o el empleado se dio de baja mientras
    // la sesion estaba abierta: se corta ahi mismo.
    if (rows.length === 0) {
      return req.session.destroy(() => res.redirect('/login'));
    }

    const actual = rows[0];
    req.session.usuario = {
      id_usuario: req.session.usuario.id_usuario,
      username: actual.username,
      nombre: [actual.nombre, actual.apellido].filter(Boolean).join(' '),
      rol: actual.rol,
      id_sucursal_asignada: actual.id_sucursal_asignada,
      sucursal: actual.sucursal,
    };
    res.locals.usuario = req.session.usuario;

    siguiente();
  } catch (error) {
    siguiente(error);
  }
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
