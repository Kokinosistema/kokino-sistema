'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const AlmacenPg = require('connect-pg-simple')(session);
const { pool } = require('./db');

const { exigirLogin, exponerUsuario, exponerAviso } = require('./middleware/sesion');
const { sucursalDeTrabajo, mostrarEleccion, cambiarSucursal } = require('./sucursales');
const { pesos } = require('./dinero');
const { CARTAS, conCarta } = require('./cartas');
const rutasAuth = require('./rutas/auth');
const rutasInicio = require('./rutas/inicio');
const rutasProveedores = require('./rutas/proveedores');
const rutasUsuarios = require('./rutas/usuarios');
const rutasClientes = require('./rutas/clientes');
const rutasRecetas = require('./rutas/recetas');
const rutasCaja = require('./rutas/caja');
const rutasVentas = require('./rutas/ventas');
const rutasPedidosYa = require('./rutas/pedidosya');
const rutasHistorial = require('./rutas/historial');
const rutasInsumos = require('./rutas/insumos');
const rutasProductos = require('./rutas/productos');
const rutasFabricacion = require('./rutas/fabricacion');
const rutasEnvios = require('./rutas/envios');
const rutasMayoristas = require('./rutas/mayoristas');
const rutasCotizar = require('./rutas/cotizar');
const rutasListas = require('./rutas/listas');
const rutasCostos = require('./rutas/costos');
const rutasMercaderia = require('./rutas/mercaderia');
const rutasStock = require('./rutas/stock');
const rutasSucursales = require('./rutas/sucursales');

function crearAplicacion() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'vistas'));
  // Todas las vistas muestran la plata igual: $17.500 o $17.500,15.
  app.locals.pesos = pesos;

  // Publicado, siempre se entra por HTTPS: en una PC del local, cuando se
  // pone NODE_ENV=produccion; en Vercel, siempre (salvo con "vercel dev",
  // que corre en la compu sin HTTPS).
  const conHttps = process.env.NODE_ENV === 'produccion'
    || ['production', 'preview'].includes(process.env.VERCEL_ENV);

  // Detras de un proxy con HTTPS (como los servicios en la nube), para que la
  // cookie segura funcione y la IP sea la del cliente.
  if (conHttps) app.set('trust proxy', 1);

  // Para saber desde afuera si el sistema esta andando (el administrador de
  // procesos o el servicio de hosting lo consultan): responde "ok" si la base
  // contesta. No necesita login ni muestra datos.
  app.get('/salud', async (req, res) => {
    try {
      await require('./db').consultar('SELECT 1');
      res.type('text').send('ok');
    } catch (error) {
      res.status(503).type('text').send('sin base de datos');
    }
  });

  // Los formularios HTML mandan los datos en este formato, no en JSON.
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  // El cotizador lo usan el navegador y el servidor (src/rutas/cotizar.js).
  // No va en public/: en Vercel, un archivo de public/ que el servidor carga
  // con require no se sirve como estatico y el pedido cae en el login. Va
  // antes del login porque la pagina lo pide con <script>.
  app.get('/cotizador.js', (req, res) => res.sendFile(path.join(__dirname, 'cotizador.js')));

  app.use(
    session({
      name: 'kokino.sid',
      secret: process.env.SESSION_SECRET,
      // Las sesiones se guardan en la base (tabla sesiones), no en la memoria
      // del servidor: asi un reinicio no desloguea a nadie ni pierde el
      // pedido que se estaba armando en Vender. Las vencidas se borran solas.
      store: new AlmacenPg({ pool, tableName: 'sesiones' }),
      resave: false,
      // No crear sesion hasta que haya algo que guardar: sin esto se le abre
      // una a cualquiera que pase por el login sin entrar.
      saveUninitialized: false,
      cookie: {
        httpOnly: true,   // el JavaScript de la pagina no puede leerla
        sameSite: 'lax',  // no viaja desde otro sitio
        secure: conHttps, // solo por HTTPS al publicar
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
  app.get('/sucursal', mostrarEleccion);
  app.post('/sucursal', cambiarSucursal);
  app.use(rutasEnvios.exponerPorRecibir);

  // Cada router se monta bajo su prefijo, no en la raiz. Importa mas de lo que
  // parece: adentro de estos routers hay un router.use(exigirRol(...)) que se
  // aplica a todo lo que pase por ahi, y montados en la raiz pasaba por ahi
  // todo el sistema. Asi el permiso de cada router queda encerrado en su
  // propia direccion, y el orden en que se montan deja de importar.
  app.use(rutasInicio);
  app.use('/proveedores', rutasProveedores);
  app.use('/usuarios', rutasUsuarios);
  // Antes que clientes: sus direcciones (/clientes/listas...) no tienen que
  // caer en el /:id del router de clientes.
  app.use('/clientes/listas', rutasListas);
  app.use('/clientes', rutasMayoristas);
  app.use('/clientes', rutasClientes);
  app.use('/cotizar', rutasCotizar);
  app.use('/recetas', rutasRecetas);
  app.use('/caja', rutasCaja);
  // Vender es una sola pantalla para las dos cartas (src/cartas.js): el
  // mismo router, montado dos veces, cada una con su carta. En /pedidosya
  // van antes las pantallas de los duenos para editar esa carta.
  app.use('/ventas', conCarta(CARTAS.mostrador), rutasVentas);
  app.use('/pedidosya', conCarta(CARTAS.pedidosya), rutasPedidosYa, rutasVentas);
  app.use('/insumos', rutasInsumos);
  app.use('/productos', rutasProductos);
  app.use('/fabricacion', rutasFabricacion);
  app.use('/envios', rutasEnvios);
  app.use('/costos', rutasCostos);
  app.use('/mercaderia', rutasMercaderia);
  app.use('/stock', rutasStock);
  app.use('/sucursales', rutasSucursales);
  app.use('/historial', rutasHistorial);

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
