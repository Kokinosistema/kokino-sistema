'use strict';

// Las dos cartas con las que se vende (pedido de la usuaria el 2026-10-15).
// La pantalla de Vender es una sola y sirve a las dos: cambia que precio
// cobra, en que direccion vive y por que canales entra la venta. Asi un
// arreglo en Vender llega solo a PedidosYa, sin dos copias que se separen.
//
//   - tipoPrecio: que precio de la tabla precios cobra. Un producto esta en
//     la carta si tiene ese precio vigente.
//   - canales: los que se pueden elegir al cobrar. Con uno solo no se
//     pregunta: va fijo.
//   - sesion: donde se guarda el pedido a medio armar. Cada carta tiene el
//     suyo, para que lo que se empezo en una no aparezca en la otra.
//   - categoriasVacias: si los duenos ven tambien las categorias sin
//     productos. En el mostrador si: una categoria recien creada necesita un
//     lugar donde cargarle el primero. En PedidosYa no: ahi no se crean
//     categorias, y verlas vacias solo estorba al vender.
//   - tarjetaNueva: la tarjeta de los duenos al final de las categorias.
//   - enlaces: a donde van los botones de los duenos dentro de una
//     categoria. En el mostrador se crean y editan productos; en PedidosYa
//     no se crean: se suma uno que ya existe (desde la tarjeta) y solo se
//     edita su precio.

// Todos los canales, con su nombre para mostrar. Se usa tambien para
// nombrar el canal de ventas ya hechas.
const CANALES = [
  { valor: 'MOSTRADOR', texto: 'Mostrador' },
  { valor: 'TELEFONO', texto: 'Teléfono' },
  { valor: 'PEDIDOSYA', texto: 'PedidosYa' },
];

const canales = (...valores) => CANALES.filter((c) => valores.includes(c.valor));

const CARTAS = {
  mostrador: {
    base: '/ventas',
    titulo: 'Vender',
    tipoPrecio: 'MINORISTA',
    canales: canales('MOSTRADOR', 'TELEFONO'),
    sesion: 'pedidos',
    categoriasVacias: true,
    tarjetaNueva: {
      href: '/productos/categorias/nueva?volver=ventas',
      titulo: 'Agregar categoría',
      detalle: 'Y después sus productos',
    },
    enlaces: {
      agregarProducto: (idCategoria) => '/productos/nuevo?categoria=' + idCategoria + '&volver=ventas',
      editar: (idCategoria) => '/productos/categorias/' + idCategoria + '/editar?volver=ventas',
      textoEditar: 'Editar productos',
    },
  },
  pedidosya: {
    base: '/pedidosya',
    titulo: 'Pedidos Ya',
    tipoPrecio: 'PEDIDOSYA',
    canales: canales('PEDIDOSYA'),
    sesion: 'pedidosPedidosYa',
    categoriasVacias: false,
    tarjetaNueva: {
      href: '/pedidosya/agregar',
      titulo: 'Sumar a PedidosYa',
      detalle: 'Un producto que ya existe',
    },
    enlaces: {
      agregarProducto: null,
      editar: (idCategoria) => '/pedidosya/categorias/' + idCategoria + '/editar',
      textoEditar: 'Editar precios',
    },
  },
};

// Middleware: deja la carta a mano para las rutas (req.carta) y las vistas
// (carta).
function conCarta(carta) {
  return (req, res, siguiente) => {
    req.carta = carta;
    res.locals.carta = carta;
    siguiente();
  };
}

module.exports = { CANALES, CARTAS, conCarta };
