'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { consultar } = require('../db');
const intentos = require('../intentos');

const router = express.Router();

// Hash descartable con el que se compara cuando el usuario no existe. Suena
// raro comparar contra algo que nunca va a dar bien, pero evita que el login
// tarde distinto segun si el usuario existe o no: sin esto, una respuesta
// rapida delataria "ese usuario no existe" y una lenta "existe, erraste la
// clave", y alcanzaria para ir descubriendo nombres de usuario validos.
const HASH_SENUELO = bcrypt.hashSync('usuario inexistente', 12);

// Un solo mensaje para los dos casos, por lo mismo: no decirle a nadie si
// acerto el usuario. Al empleado le da igual, sabe cual es el suyo.
const ERROR_CREDENCIALES = 'Usuario o contraseña incorrectos. Probá de nuevo.';

router.get('/login', (req, res) => {
  // Si ya entro, no tiene sentido mostrarle el formulario otra vez.
  if (req.session.usuario) return res.redirect('/');
  res.render('login', { error: null, username: '' });
});

router.post('/login', async (req, res, siguiente) => {
  const username = (req.body.username || '').trim();
  const contrasena = req.body.contrasena || '';

  try {
    // Bloqueado por demasiados intentos (ver src/intentos.js): ni se mira la
    // contrasena, asi probar mientras dura el bloqueo no sirve de nada.
    const minutos = await intentos.minutosBloqueado(username);
    if (minutos > 0) {
      return res.status(429).render('login', {
        error: 'Demasiados intentos con este usuario. Probá de nuevo en ' + minutos + (minutos === 1 ? ' minuto.' : ' minutos.'),
        username,
      });
    }

    // La consulta trae todo lo que la sesion necesita de una sola vez: el rol
    // decide que pantallas ve, y la sucursal asignada decide sobre que datos
    // opera. Los duenos la tienen en null, que aca significa "las dos".
    const { rows } = await consultar(
      `SELECT u.id_usuario,
              u.username,
              u.password_hash,
              r.nombre_rol                                  AS rol,
              e.nombre,
              e.apellido,
              e.id_sucursal_asignada,
              s.nombre                                      AS sucursal
         FROM usuarios u
         JOIN roles r     ON r.id_rol = u.id_rol
         JOIN empleados e ON e.id_empleado = u.id_empleado
         LEFT JOIN sucursales s ON s.id_sucursal = e.id_sucursal_asignada
        WHERE u.username = $1
          AND u.activo
          AND e.activo`,
      [username]
    );

    const usuario = rows[0];
    const coincide = await bcrypt.compare(
      contrasena,
      usuario ? usuario.password_hash : HASH_SENUELO
    );

    if (!usuario || !coincide) {
      await intentos.anotarFallo(username);
      return res.status(401).render('login', { error: ERROR_CREDENCIALES, username });
    }

    // Renovar el id de sesion al entrar cierra la puerta a que alguien deje
    // preparada una sesion vacia en la maquina del local y despues la reuse ya
    // logueada. En un mostrador con una PC compartida esto no es teorico.
    await intentos.olvidar(username);
    req.session.regenerate((err) => {
      if (err) return siguiente(err);

      // El hash no entra en la sesion: no hace falta para nada y no tiene por
      // que andar dando vueltas en memoria del servidor.
      req.session.usuario = {
        id_usuario: usuario.id_usuario,
        username: usuario.username,
        nombre: [usuario.nombre, usuario.apellido].filter(Boolean).join(' '),
        rol: usuario.rol,
        id_sucursal_asignada: usuario.id_sucursal_asignada,
        sucursal: usuario.sucursal,
      };

      const destino = req.session.destino || '/';
      delete req.session.destino;
      res.redirect(destino);
    });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/logout', (req, res, siguiente) => {
  req.session.destroy((err) => {
    if (err) return siguiente(err);
    res.clearCookie('kokino.sid');
    res.redirect('/login');
  });
});

module.exports = router;
