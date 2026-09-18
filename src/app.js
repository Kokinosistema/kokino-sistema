'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');

const { exigirLogin, exponerUsuario } = require('./middleware/sesion');
const rutasAuth = require('./rutas/auth');
const rutasInicio = require('./rutas/inicio');

function crearAplicacion() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'vistas'));

  // Los formularios HTML mandan los datos en este formato, no en JSON.
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use(
    session({
      name: 'kokino.sid',
      secret: process.env.SESSION_SECRET,
      resave: false,
      // No crear sesion hasta que haya algo que guardar: sin esto se le abre
      // una a cualquiera que pase por el login sin entrar.
      saveUninitialized: false,
      cookie: {
        httpOnly: true,   // el JavaScript de la pagina no puede leerla
        sameSite: 'lax',  // no viaja desde otro sitio
        secure: process.env.NODE_ENV === 'produccion', // solo por HTTPS al publicar
        maxAge: 12 * 60 * 60 * 1000, // 12 horas: cubre un turno entero
      },
    })
  );

  app.use(exponerUsuario);

  // El login es lo unico que se puede ver sin estar logueado.
  app.use(rutasAuth);
  app.use(exigirLogin);
  app.use(rutasInicio);

  app.use((req, res) => {
    res.status(404).render('error', {
      titulo: 'No encontramos esa pantalla',
      mensaje: 'La direccion que pediste no existe en el sistema.',
    });
  });

  // Ultimo recurso. Al usuario se le muestra un mensaje generico y el detalle
  // queda en la consola del servidor: un error de base de datos puede filtrar
  // nombres de tablas o datos, y eso no tiene por que verse en el mostrador.
  app.use((error, req, res, _siguiente) => {
    console.error(error);
    res.status(500).render('error', {
      titulo: 'Algo salio mal',
      mensaje: 'Hubo un problema al procesar el pedido. Volve a intentar.',
    });
  });

  return app;
}

module.exports = { crearAplicacion };
