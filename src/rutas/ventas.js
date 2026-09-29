'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { sucursalesDisponibles } = require('../sucursales');

const router = express.Router();

const CANALES = [
  { valor: 'MOSTRADOR', texto: 'Mostrador' },
  { valor: 'TELEFONO', texto: 'Teléfono' },
  { valor: 'PEDIDOSYA', texto: 'PedidosYa' },
];

// Tope por linea: nadie vende mil cucuruchos en una venta de mostrador, y un
// numero asi casi siempre es un dedo que se quedo apretado.
const CANTIDAD_MAXIMA = 999;

// El precio que rige hoy. Se busca siempre en la base, tanto para mostrar el
// pedido como para guardarlo: el pedido en la sesion guarda solo que producto
// y cuantos, nunca el precio, asi un aumento cargado a mitad del turno se
// aplica en la venta siguiente y nadie puede cobrar un precio inventado
// tocando la pagina.
const SQL_PRECIO_VIGENTE = `
  JOIN precios pr ON pr.id_producto = p.id_producto
                 AND pr.tipo_precio = 'MINORISTA'
                 AND pr.fecha_vigencia_hasta IS NULL
                 AND pr.fecha_vigencia_desde <= current_date`;

// El pedido se arma en la sesion y recien se escribe en la base al cobrar,
// todo junto. No se puede ir guardando linea por linea porque la base congela
// las lineas de una venta apenas existen: una venta a medio armar quedaria
// registrada y sin forma de corregirla.
//
// Va uno por sucursal porque el dueno puede cambiar de sucursal en el medio,
// y no tiene que encontrarse en Alem lo que empezo a cargar en Entre Rios.
function pedidoDe(req, idSucursal) {
  if (!req.session.pedidos) req.session.pedidos = {};
  if (!req.session.pedidos[idSucursal]) req.session.pedidos[idSucursal] = [];
  return req.session.pedidos[idSucursal];
}

function vaciarPedido(req, idSucursal) {
  if (req.session.pedidos) delete req.session.pedidos[idSucursal];
}

function sucursalPedida(valor, sucursales) {
  const id = Number(valor);
  return sucursales.some((s) => s.id_sucursal === id) ? id : null;
}

async function cajaAbiertaDe(idSucursal) {
  const { rows } = await consultar(
    `SELECT id_caja, turno, fecha_apertura
       FROM cajas
      WHERE id_sucursal = $1 AND fecha_cierre IS NULL`,
    [idSucursal]
  );
  return rows[0] || null;
}

// Arma todo lo que necesita la pantalla y la muestra. Lo usan tanto la carga
// normal como los errores al cobrar, para que el pedido siga a la vista.
async function mostrar(req, res, { sucursales, elegida, errores = [], estado = 200, canal, medio }) {
  const caja = await cajaAbiertaDe(elegida);

  const { rows: productos } = await consultar(
    `SELECT p.id_producto, p.nombre, c.nombre AS categoria, pr.precio
       FROM productos p
       JOIN categorias c ON c.id_categoria = p.id_categoria
       ${SQL_PRECIO_VIGENTE}
      WHERE p.activo
      ORDER BY c.nombre, p.nombre`
  );

  const catalogo = [];
  const porId = new Map();
  for (const p of productos) {
    porId.set(p.id_producto, p);
    let grupo = catalogo[catalogo.length - 1];
    if (!grupo || grupo.categoria !== p.categoria) {
      grupo = { categoria: p.categoria, productos: [] };
      catalogo.push(grupo);
    }
    grupo.productos.push(p);
  }

  // Si un producto del pedido se dio de baja o se quedo sin precio mientras
  // se armaba, se saca y se avisa, en vez de fallar recien al cobrar.
  const pedido = pedidoDe(req, elegida);
  const faltantes = pedido.filter((l) => !porId.has(l.id_producto));
  if (faltantes.length > 0) {
    req.session.pedidos[elegida] = pedido.filter((l) => porId.has(l.id_producto));
    errores = errores.concat('Se sacó del pedido un producto que ya no está a la venta.');
  }

  const lineas = pedidoDe(req, elegida).map((l) => {
    const p = porId.get(l.id_producto);
    return {
      id_producto: l.id_producto,
      nombre: p.nombre,
      cantidad: l.cantidad,
      precio: Number(p.precio),
      subtotal: Number(p.precio) * l.cantidad,
    };
  });
  const total = lineas.reduce((suma, l) => suma + l.subtotal, 0);

  const { rows: medios } = await consultar(
    'SELECT id_medio_pago, nombre FROM medios_pago WHERE activo ORDER BY id_medio_pago'
  );

  let ultimas = [];
  if (caja) {
    ({ rows: ultimas } = await consultar(
      `SELECT vt.id_venta, vt.fecha_hora, vt.canal_venta, vt.total,
              (SELECT string_agg(m.nombre, ', ' ORDER BY m.nombre)
                 FROM pagos_venta pv
                 JOIN medios_pago m ON m.id_medio_pago = pv.id_medio_pago
                WHERE pv.id_venta = vt.id_venta) AS medios
         FROM ventas_totales vt
        WHERE vt.id_caja = $1 AND NOT vt.anulada
        ORDER BY vt.fecha_hora DESC
        LIMIT 10`,
      [caja.id_caja]
    ));
  }

  res.status(estado).render('ventas/vender', {
    sucursales, elegida, caja, catalogo, lineas, total, medios, ultimas,
    CANALES, errores,
    canal: canal || 'MOSTRADOR',
    medio: Number(medio) || (medios[0] && medios[0].id_medio_pago),
  });
}

// No lleva exigirRol: vender es la tarea de mostrador por excelencia. Lo que
// se restringe es la sucursal, igual que en la caja.
router.get('/', async (req, res, siguiente) => {
  try {
    const sucursales = await sucursalesDisponibles(req.session.usuario);
    const elegida = sucursalPedida(req.query.sucursal, sucursales) || sucursales[0].id_sucursal;
    await mostrar(req, res, { sucursales, elegida });
  } catch (error) {
    siguiente(error);
  }
});

// Agregar, sacar de a uno, quitar la linea o vaciar el pedido. Solo tocan la
// sesion; la base no se entera hasta que se cobra.
router.post('/pedido', async (req, res, siguiente) => {
  try {
    const sucursales = await sucursalesDisponibles(req.session.usuario);
    const elegida = sucursalPedida(req.body.id_sucursal, sucursales);
    if (!elegida) {
      req.session.aviso = 'Esa no es una sucursal sobre la que puedas operar.';
      return res.redirect('/ventas');
    }

    const pedido = pedidoDe(req, elegida);
    const idProducto = Number(req.body.id_producto);
    const linea = pedido.find((l) => l.id_producto === idProducto);

    switch (req.body.accion) {
      case 'agregar':
        if (!Number.isInteger(idProducto) || idProducto <= 0) break;
        if (linea) {
          linea.cantidad = Math.min(linea.cantidad + 1, CANTIDAD_MAXIMA);
        } else {
          pedido.push({ id_producto: idProducto, cantidad: 1 });
        }
        break;
      case 'restar':
        if (linea) linea.cantidad -= 1;
        break;
      case 'quitar':
        if (linea) linea.cantidad = 0;
        break;
      case 'vaciar':
        pedido.length = 0;
        break;
      default:
        break;
    }
    req.session.pedidos[elegida] = pedido.filter((l) => l.cantidad > 0);

    res.redirect('/ventas?sucursal=' + elegida);
  } catch (error) {
    siguiente(error);
  }
});

router.post('/cobrar', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = await sucursalesDisponibles(usuario);
    const elegida = sucursalPedida(req.body.id_sucursal, sucursales);
    if (!elegida) {
      req.session.aviso = 'Esa no es una sucursal sobre la que puedas operar.';
      return res.redirect('/ventas');
    }

    const { canal, id_medio_pago: medio } = req.body;
    const pedido = pedidoDe(req, elegida);
    const volver = (errores) => mostrar(req, res, { sucursales, elegida, errores, estado: 400, canal, medio });

    const errores = [];
    if (pedido.length === 0) errores.push('El pedido está vacío: agregá al menos un producto.');
    if (!CANALES.some((c) => c.valor === canal)) errores.push('Elegí por dónde fue la venta.');
    if (!Number.isInteger(Number(medio))) errores.push('Elegí con qué pagó.');
    if (errores.length > 0) return volver(errores);

    // Todo en una transaccion: la venta, sus lineas y el pago se guardan
    // juntos o no se guarda nada. La caja se bloquea mientras tanto (FOR
    // UPDATE), y el cierre de caja la bloquea igual, asi que una venta y un
    // cierre simultaneos se esperan uno al otro: la venta no puede quedar
    // cobrada en una caja que se cerro en el medio sin contarla.
    const resultado = await conTransaccion(async (ejecutar) => {
      const { rows: cajas } = await ejecutar(
        `SELECT id_caja FROM cajas
          WHERE id_sucursal = $1 AND fecha_cierre IS NULL
          FOR UPDATE`,
        [elegida]
      );
      if (cajas.length === 0) {
        return { error: 'No hay una caja abierta en esta sucursal. Abrila desde Caja y volvé a cobrar.' };
      }
      const idCaja = cajas[0].id_caja;

      const { rows: medios } = await ejecutar(
        'SELECT id_medio_pago FROM medios_pago WHERE id_medio_pago = $1 AND activo',
        [medio]
      );
      if (medios.length === 0) return { error: 'Elegí con qué pagó.' };

      const ids = pedido.map((l) => l.id_producto);
      const { rows: precios } = await ejecutar(
        `SELECT p.id_producto, pr.precio
           FROM productos p
           ${SQL_PRECIO_VIGENTE}
          WHERE p.activo AND p.id_producto = ANY($1::int[])`,
        [ids]
      );
      if (precios.length !== ids.length) {
        return { error: 'Algún producto del pedido ya no está a la venta. Revisá el pedido y volvé a cobrar.' };
      }
      const precioDe = new Map(precios.map((p) => [p.id_producto, p.precio]));

      const { rows: [venta] } = await ejecutar(
        `INSERT INTO ventas (id_caja, id_usuario, id_sucursal, canal_venta, tipo_venta)
         VALUES ($1, $2, $3, $4, 'MINORISTA')
         RETURNING id_venta`,
        [idCaja, usuario.id_usuario, elegida, canal]
      );

      // La cuenta se hace en centavos enteros: sumar precios con decimales en
      // JavaScript da cosas como 0.1 + 0.2 = 0.30000000000000004.
      let centavos = 0;
      for (const l of pedido) {
        const precio = precioDe.get(l.id_producto);
        await ejecutar(
          `INSERT INTO venta_detalle (id_venta, id_producto, cantidad, precio_unitario_aplicado)
           VALUES ($1, $2, $3, $4)`,
          [venta.id_venta, l.id_producto, l.cantidad, precio]
        );
        centavos += Math.round(Number(precio) * 100) * l.cantidad;
      }

      // Un pago de cero no existe (la base lo rechaza), y una venta que suma
      // cero, como un producto de regalo, simplemente no lleva pago.
      if (centavos > 0) {
        await ejecutar(
          `INSERT INTO pagos_venta (id_venta, id_medio_pago, id_caja, id_usuario, monto)
           VALUES ($1, $2, $3, $4, $5)`,
          [venta.id_venta, medio, idCaja, usuario.id_usuario, (centavos / 100).toFixed(2)]
        );
      }

      return { total: centavos / 100 };
    });

    if (resultado.error) return volver([resultado.error]);

    vaciarPedido(req, elegida);
    req.session.aviso = 'Venta registrada: $' + resultado.total.toFixed(2) + '.';
    res.redirect('/ventas?sucursal=' + elegida);
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
