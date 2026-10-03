'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');

const { exigirLogin, exponerUsuario, exponerAviso } = require('./middleware/sesion');
const { sucursalDeTrabajo, cambiarSucursal } = require('./sucursales');
const { pesos } = require('./dinero');
const rutasAuth = require('./rutas/auth');
const rutasInicio = require('./rutas/inicio');
const rutasProveedores = require('./rutas/proveedores');
const rutasUsuarios = require('./rutas/usuarios');
const rutasClientes = require('./rutas/clientes');
const rutasRecetas = require('./rutas/recetas');
const rutasCaja = require('./rutas/caja');
const rutasVentas = require('./rutas/ventas');
const rutasInsumos = require('./rutas/insumos');
const rutasProductos = require('./rutas/productos');
const rutasFabricacion = require('./rutas/fabricacion');
const rutasEnvios = require('./rutas/envios');

function crearAplicacion() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'vistas'));
  // Todas las vistas muestran la plata igual: $17.500 o $17.500,15.
  app.locals.pesos = pesos;

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
  // La barra lateral resalta la seccion en la que se esta; para eso necesita
  // saber la direccion pedida.
  app.use((req, res, siguiente) => {
    res.locals.rutaActual = req.path;
    siguiente();
  });
  app.use(exponerAviso);

  // El login es lo unico que se puede ver sin estar logueado.
  app.use(rutasAuth);
  app.use(exigirLogin);
  app.use(sucursalDeTrabajo);
  app.post('/sucursal', cambiarSucursal);

  // Cada router se monta bajo su prefijo, no en la raiz. Importa mas de lo que
  // parece: adentro de estos routers hay un router.use(exigirRol(...)) que se
  // aplica a todo lo que pase por ahi, y montados en la raiz pasaba por ahi
  // todo el sistema. Asi el permiso de cada router queda encerrado en su
  // propia direccion, y el orden en que se montan deja de importar.
  app.use(rutasInicio);
  app.use('/proveedores', rutasProveedores);
  app.use('/usuarios', rutasUsuarios);
  app.use('/clientes', rutasClientes);
  app.use('/recetas', rutasRecetas);
  app.use('/caja', rutasCaja);
  app.use('/ventas', rutasVentas);
  app.use('/insumos', rutasInsumos);
  app.use('/productos', rutasProductos);
  app.use('/fabricacion', rutasFabricacion);
  app.use('/envios', rutasEnvios);

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
