'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { CAMBIO_DE_SUCURSAL } = require('../sucursales');
const { parsearMonto, MONTO_INVALIDO, pesos, aCentavos, textoPesos } = require('../dinero');
const { CANALES } = require('../cartas');

// Este router sirve a las dos cartas (src/cartas.js): se monta en /ventas
// para el mostrador y en /pedidosya para PedidosYa, y cada pedido trae su
// carta en req.carta. Todo lo que cambia entre una y otra sale de ahi.
const router = express.Router();

// Valor de "Con que pago" cuando se paga con mas de un medio. Entonces llega
// un monto por medio, en campos monto_<id_medio_pago>.
const VARIOS_MEDIOS = 'varios';

function montosPorMedio(cuerpo) {
  const montos = {};
  for (const [campo, valor] of Object.entries(cuerpo)) {
    const id = /^monto_(\d+)$/.exec(campo);
    if (id) montos[id[1]] = typeof valor === 'string' ? valor.trim() : '';
  }
  return montos;
}

// Tope por linea: nadie vende mil cucuruchos en una venta de mostrador, y un
// numero asi casi siempre es un dedo que se quedo apretado.
const CANTIDAD_MAXIMA = 999;

// El precio que rige hoy. Se busca siempre en la base, tanto para mostrar el
// pedido como para guardarlo: el pedido en la sesion guarda solo que producto
// y cuantos, nunca el precio, asi un aumento cargado a mitad del turno se
// aplica en la venta siguiente y nadie puede cobrar un precio inventado
// tocando la pagina.
//
// El tipo de precio va escrito en el SQL y no como parametro porque sale de
// la carta, que esta fija en el codigo: nunca de lo que manda el navegador.
const TIPOS_DE_PRECIO = ['MINORISTA', 'PEDIDOSYA'];
function sqlPrecioVigente(carta) {
  if (!TIPOS_DE_PRECIO.includes(carta.tipoPrecio)) throw new Error('Tipo de precio desconocido: ' + carta.tipoPrecio);
  return `
  JOIN precios pr ON pr.id_producto = p.id_producto
                 AND pr.tipo_precio = '${carta.tipoPrecio}'
                 AND pr.fecha_vigencia_hasta IS NULL
                 AND pr.fecha_vigencia_desde <= current_date`;
}

// El pedido se arma en la sesion y recien se escribe en la base al cobrar,
// todo junto. No se puede ir guardando linea por linea porque la base congela
// las lineas de una venta apenas existen: una venta a medio armar quedaria
// registrada y sin forma de corregirla.
//
// Va uno por sucursal porque el dueno puede cambiar de sucursal en el medio,
// y no tiene que encontrarse en Alem lo que empezo a cargar en Entre Rios.
// Y cada carta guarda el suyo aparte (req.carta.sesion).
function pedidosDe(req) {
  const clave = req.carta.sesion;
  if (!req.session[clave]) req.session[clave] = {};
  return req.session[clave];
}

function pedidoDe(req, idSucursal) {
  const pedidos = pedidosDe(req);
  if (!pedidos[idSucursal]) pedidos[idSucursal] = [];
  return pedidos[idSucursal];
}

function guardarPedido(req, idSucursal, lineas) {
  pedidosDe(req)[idSucursal] = lineas;
}

function vaciarPedido(req, idSucursal) {
  delete pedidosDe(req)[idSucursal];
}

function sucursalPedida(valor, sucursales) {
  const id = Number(valor);
  return sucursales.some((s) => s.id_sucursal === id) ? id : null;
}

// A donde volver despues de tocar el pedido: a la misma categoria y con la
// misma busqueda, para seguir cargando sin volver a entrar ni a tipear. Sin
// categoria es el inicio de Vender, con la busqueda general si habia.
function direccionVender(carta, categoria, busqueda) {
  const idCategoria = Number(categoria);
  const texto = limpiarBusqueda(busqueda);
  if (!Number.isInteger(idCategoria) || idCategoria <= 0) {
    return carta.base + (texto ? '?busqueda=' + encodeURIComponent(texto) : '');
  }
  return carta.base + '?categoria=' + idCategoria
    + (texto ? '&busqueda=' + encodeURIComponent(texto) : '');
}

function limpiarBusqueda(valor) {
  return typeof valor === 'string' ? valor.trim().slice(0, 100) : '';
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
async function mostrar(req, res, {
  sucursales, elegida, categoria, busqueda, errores = [], estado = 200, canal, medio, montos = {}, pagaCon = '',
}) {
  const caja = await cajaAbiertaDe(elegida);

  const { rows: productos } = await consultar(
    `SELECT p.id_producto, p.nombre, c.id_categoria, c.nombre AS categoria, c.orden, pr.precio
       FROM productos p
       JOIN categorias c ON c.id_categoria = p.id_categoria
       ${sqlPrecioVigente(req.carta)}
      WHERE p.activo
      ORDER BY c.orden NULLS LAST, c.nombre, p.nombre`
  );

  const catalogo = [];
  const porId = new Map();
  for (const p of productos) {
    porId.set(p.id_producto, p);
    let grupo = catalogo[catalogo.length - 1];
    if (!grupo || grupo.categoria !== p.categoria) {
      grupo = { id_categoria: p.id_categoria, categoria: p.categoria, orden: p.orden, productos: [] };
      catalogo.push(grupo);
    }
    grupo.productos.push(p);
  }

  // Los duenos ven tambien las categorias que todavia no tienen productos a
  // la venta, para poder cargarles el primero desde aca. El empleado no: para
  // el no hay nada que vender ahi. En PedidosYa tampoco los duenos: ver
  // src/cartas.js (categoriasVacias).
  const esDueno = req.session.usuario.rol === 'administrador';
  if (esDueno && req.carta.categoriasVacias) {
    const { rows: todas } = await consultar(
      "SELECT id_categoria, nombre, orden FROM categorias WHERE tipo = 'PRODUCTO'"
    );
    for (const c of todas) {
      if (!catalogo.some((g) => g.id_categoria === c.id_categoria)) {
        catalogo.push({ id_categoria: c.id_categoria, categoria: c.nombre, orden: c.orden, productos: [] });
      }
    }
    // Mismo orden que la consulta de productos: por orden, y las que no
    // tienen, al final y por nombre.
    catalogo.sort((a, b) => (a.orden ?? Infinity) - (b.orden ?? Infinity)
      || a.categoria.localeCompare(b.categoria, 'es'));
  }

  // Sin categoria elegida (o con una que no existe) se muestra la grilla de
  // categorias; con una, sus productos.
  const abierta = catalogo.find((g) => g.id_categoria === Number(categoria)) || null;

  // Si un producto del pedido se dio de baja o se quedo sin precio mientras
  // se armaba, se saca y se avisa, en vez de fallar recien al cobrar.
  const pedido = pedidoDe(req, elegida);
  const faltantes = pedido.filter((l) => !porId.has(l.id_producto));
  if (faltantes.length > 0) {
    guardarPedido(req, elegida, pedido.filter((l) => porId.has(l.id_producto)));
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
    'SELECT id_medio_pago, nombre, afecta_caja_efectivo FROM medios_pago WHERE activo ORDER BY id_medio_pago'
  );

  let ultimas = [];
  if (caja) {
    ({ rows: ultimas } = await consultar(
      // Las anuladas tambien se listan, tachadas y con su motivo: que
      // desaparezcan sin rastro haria pensar que la venta nunca existio.
      `SELECT vt.id_venta, vt.fecha_hora, vt.canal_venta, vt.total, vt.anulada,
              v.motivo_anulacion,
              (SELECT e.nombre
                 FROM usuarios u
                 JOIN empleados e ON e.id_empleado = u.id_empleado
                WHERE u.id_usuario = v.id_usuario_anulacion) AS anulo,
              (SELECT string_agg(m.nombre, ', ' ORDER BY m.nombre)
                 FROM pagos_venta pv
                 JOIN medios_pago m ON m.id_medio_pago = pv.id_medio_pago
                WHERE pv.id_venta = vt.id_venta) AS medios
         FROM ventas_totales vt
         JOIN ventas v ON v.id_venta = vt.id_venta
        WHERE vt.id_caja = $1 AND vt.canal_venta = ANY($2::text[])
        ORDER BY vt.fecha_hora DESC
        LIMIT 10`,
      [caja.id_caja, req.carta.canales.map((c) => c.valor)]
    ));
  }

  // Lo mas vendido (pedido de la usuaria el 2026-10-07): los 4 productos que
  // mas unidades vendieron en esta sucursal en los ultimos 30 dias, para
  // sumarlos de un toque cuando hay mucha gente. Solo los que siguen a la venta.
  // Cada carta cuenta sus propias ventas: lo que mas sale por PedidosYa no
  // es lo que mas sale en el mostrador.
  const { rows: topVendidos } = await consultar(
    `SELECT d.id_producto
       FROM venta_detalle d
       JOIN ventas v ON v.id_venta = d.id_venta
      WHERE v.id_sucursal = $1 AND v.tipo_venta = 'MINORISTA' AND v.fecha_anulacion IS NULL
        AND v.canal_venta = ANY($2::text[])
        AND v.fecha_hora >= current_date - 30
      GROUP BY d.id_producto
      ORDER BY sum(d.cantidad) DESC, max(v.fecha_hora) DESC
      LIMIT 8`,
    [elegida, req.carta.canales.map((c) => c.valor)]
  );
  const masVendidos = topVendidos.map((r) => porId.get(r.id_producto)).filter(Boolean).slice(0, 4);

  res.status(estado).render('ventas/vender', {
    masVendidos,
    sucursales, elegida, caja, catalogo, abierta, lineas, total, medios, ultimas,
    CANALES, canalesAElegir: req.carta.canales, errores, CANTIDAD_MAXIMA, esDueno,
    // Cuantos de cada producto hay ya en el pedido, para mostrarlo en su tarjeta.
    enPedido: Object.fromEntries(lineas.map((l) => [l.id_producto, l.cantidad])),
    busqueda: limpiarBusqueda(busqueda),
    // Sin nada elegido de entrada: quien cobra tiene que tocar el canal y el
    // medio de pago en cada venta. Si vuelve con un error, queda lo que eligio.
    canal: canal || '',
    medio: medio === VARIOS_MEDIOS ? VARIOS_MEDIOS : (Number(medio) ? String(Number(medio)) : ''),
    montos,
    pagaCon,
    VARIOS_MEDIOS,
  });
}

// No lleva exigirRol: vender es la tarea de mostrador por excelencia. Lo que
// se restringe es la sucursal, igual que en la caja.
router.get('/', async (req, res, siguiente) => {
  try {
    const sucursales = [req.sucursal];
    const elegida = req.sucursal.id_sucursal;
    await mostrar(req, res, {
      sucursales, elegida, categoria: req.query.categoria, busqueda: req.query.busqueda,
    });
  } catch (error) {
    siguiente(error);
  }
});

// El panel del pedido solo (HTML) y cuantos hay de cada producto, para que la
// pagina lo reemplace sin recargar. Los precios se leen de la base, como
// siempre. Lo ya elegido para cobrar (canal, medio, montos) lo conserva la
// pagina, asi que aca va vacio.
async function responderPanel(req, res, elegida) {
  const pedido = pedidoDe(req, elegida);
  const ids = pedido.map((l) => l.id_producto);
  const { rows } = ids.length === 0 ? { rows: [] } : await consultar(
    `SELECT p.id_producto, p.nombre, pr.precio
       FROM productos p
       ${sqlPrecioVigente(req.carta)}
      WHERE p.activo AND p.id_producto = ANY($1::int[])`,
    [ids]
  );
  const porId = new Map(rows.map((r) => [r.id_producto, r]));
  guardarPedido(req, elegida, pedido.filter((l) => porId.has(l.id_producto)));
  const lineas = pedidoDe(req, elegida).map((l) => {
    const p = porId.get(l.id_producto);
    return { id_producto: l.id_producto, nombre: p.nombre, cantidad: l.cantidad, precio: Number(p.precio), subtotal: Number(p.precio) * l.cantidad };
  });
  const total = lineas.reduce((suma, l) => suma + l.subtotal, 0);
  const { rows: medios } = await consultar(
    'SELECT id_medio_pago, nombre, afecta_caja_efectivo FROM medios_pago WHERE activo ORDER BY id_medio_pago'
  );
  const categoria = Number(req.body.categoria);
  res.render('ventas/_pedido', {
    elegida, lineas, total, medios, CANALES, canalesAElegir: req.carta.canales, VARIOS_MEDIOS,
    abierta: Number.isInteger(categoria) && categoria > 0 ? { id_categoria: categoria } : null,
    busqueda: limpiarBusqueda(req.body.busqueda),
    canal: '', medio: '', montos: {}, pagaCon: '',
  }, (error, html) => {
    if (error) throw error;
    res.json({ html, enPedido: Object.fromEntries(lineas.map((l) => [l.id_producto, l.cantidad])) });
  });
}

// Agregar, sacar de a uno, quitar la linea o vaciar el pedido. Solo tocan la
// sesion; la base no se entera hasta que se cobra.
router.post('/pedido', async (req, res, siguiente) => {
  try {
    const sucursales = [req.sucursal];
    const elegida = sucursalPedida(req.body.id_sucursal, sucursales);
    if (!elegida) {
      req.session.aviso = CAMBIO_DE_SUCURSAL;
      return res.redirect(req.carta.base);
    }

    const pedido = pedidoDe(req, elegida);
    const idProducto = Number(req.body.id_producto);
    const linea = pedido.find((l) => l.id_producto === idProducto);

    switch (req.body.accion) {
      case 'agregar': {
        // Desde la tarjeta del producto llega la cantidad elegida; desde el
        // boton + del pedido no llega nada y se suma una.
        const cantidad = req.body.cantidad === undefined ? 1 : Number(req.body.cantidad);
        if (!Number.isInteger(idProducto) || idProducto <= 0) break;
        if (!Number.isInteger(cantidad) || cantidad < 1) {
          req.session.aviso = 'La cantidad tiene que ser un número entero, de 1 para arriba.';
          break;
        }
        if (linea) {
          linea.cantidad = Math.min(linea.cantidad + cantidad, CANTIDAD_MAXIMA);
        } else {
          pedido.push({ id_producto: idProducto, cantidad: Math.min(cantidad, CANTIDAD_MAXIMA) });
        }
        break;
      }
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
    guardarPedido(req, elegida, pedido.filter((l) => l.cantidad > 0));

    // Desde la pagina (public/vender-pedido.js) se pide solo el panel del
    // pedido actualizado, para no recargar todo con cada toque.
    if (req.get('X-Kokino-Parcial') === 'pedido') {
      return responderPanel(req, res, elegida);
    }
    res.redirect(direccionVender(req.carta, req.body.categoria, req.body.busqueda));
  } catch (error) {
    siguiente(error);
  }
});

router.post('/cobrar', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = [req.sucursal];
    const elegida = sucursalPedida(req.body.id_sucursal, sucursales);
    if (!elegida) {
      req.session.aviso = CAMBIO_DE_SUCURSAL;
      return res.redirect(req.carta.base);
    }

    const { id_medio_pago: medio } = req.body;
    // Con un solo canal (PedidosYa) no se pregunta: va fijo.
    const canales = req.carta.canales;
    const canal = canales.length === 1 ? canales[0].valor : req.body.canal;
    const variosMedios = medio === VARIOS_MEDIOS;
    const montos = montosPorMedio(req.body);
    const textoPagaCon = typeof req.body.paga_con === 'string' ? req.body.paga_con.trim() : '';
    const pedido = pedidoDe(req, elegida);
    const volver = (errores) => mostrar(req, res, {
      sucursales, elegida, categoria: req.body.categoria, errores, estado: 400, canal, medio, montos,
      pagaCon: textoPagaCon,
    });

    const errores = [];
    if (pedido.length === 0) errores.push('El pedido está vacío: agregá al menos un producto.');
    if (!canales.some((c) => c.valor === canal)) errores.push('Elegí por dónde fue la venta.');
    if (variosMedios) {
      const cargados = Object.values(montos).filter((m) => m !== '');
      if (cargados.length === 0) errores.push('Poné cuánto se pagó con cada medio.');
      if (cargados.some((m) => parsearMonto(m) === null)) {
        errores.push('Cada monto tiene que ser mayor que cero: ' + MONTO_INVALIDO + '.');
      }
    } else if (!Number.isInteger(Number(medio))) {
      errores.push('Elegí con qué pagó.');
    }
    if (errores.length > 0) return volver(errores);

    // Todo en una transaccion: la venta, sus lineas y sus pagos se guardan
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

      const ids = pedido.map((l) => l.id_producto);
      const { rows: precios } = await ejecutar(
        `SELECT p.id_producto, pr.precio
           FROM productos p
           ${sqlPrecioVigente(req.carta)}
          WHERE p.activo AND p.id_producto = ANY($1::int[])`,
        [ids]
      );
      if (precios.length !== ids.length) {
        return { error: 'Algún producto del pedido ya no está a la venta. Revisá el pedido y volvé a cobrar.' };
      }
      const precioDe = new Map(precios.map((p) => [p.id_producto, p.precio]));
      const total = pedido.reduce((suma, l) => suma + aCentavos(precioDe.get(l.id_producto)) * l.cantidad, 0);

      // Los pagos, en centavos, por medio. Con un solo medio es el total
      // entero; con varios, lo que se cargo en cada uno, que tiene que sumar
      // exactamente el total: que sobre plata es un error de tipeo, y que
      // falte es una venta a cuenta, que todavia no se hace desde aca.
      const pagos = variosMedios
        ? Object.entries(montos)
          .filter(([, m]) => m !== '')
          .map(([id, m]) => ({ id_medio_pago: Number(id), centavos: aCentavos(parsearMonto(m)) }))
        : [{ id_medio_pago: Number(medio), centavos: total }];

      const { rows: activos } = await ejecutar(
        'SELECT id_medio_pago, nombre, afecta_caja_efectivo FROM medios_pago WHERE activo AND id_medio_pago = ANY($1::int[])',
        [pagos.map((p) => p.id_medio_pago)]
      );
      if (activos.length !== pagos.length) return { error: 'Elegí con qué pagó.' };
      const nombreDe = new Map(activos.map((m) => [m.id_medio_pago, m.nombre]));

      // En efectivo y en el mostrador, con cuanto paga es obligatorio (pedido
      // de la usuaria el 2026-10-10): asi siempre se calcula el vuelto y no se
      // cobra de menos. Por telefono o PedidosYa la plata llega despues y
      // puede no saberse.
      const pagaCon = parsearMonto(textoPagaCon);
      const enEfectivo = !variosMedios && activos[0] && activos[0].afecta_caja_efectivo;
      if (enEfectivo && canal === 'MOSTRADOR' && total > 0) {
        if (pagaCon === null) {
          return { error: textoPagaCon === '' ? 'Poné con cuánto paga el cliente.' : 'Con cuánto paga: ' + MONTO_INVALIDO + '.' };
        }
        if (aCentavos(pagaCon) < total) {
          return {
            error: 'Paga con ' + textoPesos(aCentavos(pagaCon)) + ' y la venta es de ' + textoPesos(total)
              + ': faltan ' + textoPesos(total - aCentavos(pagaCon)) + '.',
          };
        }
      }

      const pagado = pagos.reduce((suma, p) => suma + p.centavos, 0);
      if (variosMedios && pagado !== total) {
        const diferencia = Math.abs(total - pagado);
        return {
          error: 'Los montos suman ' + textoPesos(pagado) + ' y la venta es de ' + textoPesos(total) + ': '
            + (pagado < total ? 'faltan ' : 'sobran ') + textoPesos(diferencia) + '.',
        };
      }

      const { rows: [venta] } = await ejecutar(
        `INSERT INTO ventas (id_caja, id_usuario, id_sucursal, canal_venta, tipo_venta)
         VALUES ($1, $2, $3, $4, 'MINORISTA')
         RETURNING id_venta`,
        [idCaja, usuario.id_usuario, elegida, canal]
      );

      for (const l of pedido) {
        await ejecutar(
          `INSERT INTO venta_detalle (id_venta, id_producto, cantidad, precio_unitario_aplicado)
           VALUES ($1, $2, $3, $4)`,
          [venta.id_venta, l.id_producto, l.cantidad, precioDe.get(l.id_producto)]
        );
      }

      // Un pago de cero no existe (la base lo rechaza), y una venta que suma
      // cero, como un producto de regalo, simplemente no lleva pago.
      for (const p of pagos.filter((pago) => pago.centavos > 0)) {
        await ejecutar(
          `INSERT INTO pagos_venta (id_venta, id_medio_pago, id_caja, id_usuario, monto)
           VALUES ($1, $2, $3, $4, $5)`,
          [venta.id_venta, p.id_medio_pago, idCaja, usuario.id_usuario, (p.centavos / 100).toFixed(2)]
        );
      }

      // El vuelto, si pago en efectivo y dijo con cuanto: solo para el aviso
      // (no se guarda; en la caja entra el total de la venta).
      const vuelto = enEfectivo && pagaCon !== null && aCentavos(pagaCon) > total ? aCentavos(pagaCon) - total : 0;

      return {
        total,
        vuelto,
        detalle: pagos.length > 1
          ? pagos.map((p) => nombreDe.get(p.id_medio_pago) + ' ' + textoPesos(p.centavos)).join(', ')
          : null,
      };
    });

    if (resultado.error) return volver([resultado.error]);

    vaciarPedido(req, elegida);
    // Despues de cobrar se vuelve a las categorias: lo que sigue es otro
    // cliente, y no tiene por que arrancar en la categoria del anterior.
    req.session.aviso = 'Venta registrada: ' + textoPesos(resultado.total)
      + (resultado.detalle ? ' (' + resultado.detalle + ')' : '') + '.'
      + (resultado.vuelto ? ' Vuelto: ' + textoPesos(resultado.vuelto) + '.' : '');
    res.redirect(direccionVender(req.carta));
  } catch (error) {
    siguiente(error);
  }
});

// ---------------------------------------------------------------------------
// Anular una venta
//
// Puede anular cualquiera que venda: el error se comete en el mostrador y se
// corrige ahi, con el cliente adelante. Queda registrado quien, cuando y por
// que, para que los duenos puedan revisarlo.

const MOTIVO_MAXIMO = 300;

// Trae la venta con lo necesario para decidir si se puede anular. Con
// bloquear, la fila de la venta queda tomada hasta el final de la
// transaccion, asi dos personas no la anulan a la vez.
async function ventaParaAnular(ejecutar, idVenta, bloquear) {
  // Una direccion como /ventas/abc/anular no llega a la base.
  if (!Number.isInteger(idVenta) || idVenta <= 0) return null;
  const { rows } = await ejecutar(
    `SELECT v.id_venta, v.id_sucursal, v.fecha_hora, v.canal_venta,
            v.fecha_anulacion, v.id_caja, c.fecha_cierre, vt.total
       FROM ventas v
       JOIN ventas_totales vt ON vt.id_venta = v.id_venta
       LEFT JOIN cajas c ON c.id_caja = v.id_caja
      WHERE v.id_venta = $1
      ${bloquear ? 'FOR UPDATE OF v' : ''}`,
    [idVenta]
  );
  return rows[0] || null;
}

// Por que no se puede anular, en castellano, o null si se puede. Son las
// mismas reglas que hace cumplir la base; se chequean antes para explicarlas
// en vez de mostrar el error de PostgreSQL.
// Cada venta se anula desde la pestana de su carta, y vuelve ahi.
function motivoParaNoAnular(venta, sucursales, carta) {
  if (!venta || !sucursales.some((s) => s.id_sucursal === venta.id_sucursal)
      || !carta.canales.some((c) => c.valor === venta.canal_venta)) {
    return 'No encontramos esa venta entre las de tu sucursal.';
  }
  if (venta.fecha_anulacion) {
    return 'Esa venta ya estaba anulada.';
  }
  if (venta.fecha_cierre) {
    return 'La caja de esa venta ya se cerró, así que no se puede anular: su arqueo está hecho. '
      + 'La corrección es una nota de crédito con fecha de hoy.';
  }
  return null;
}

async function detalleDeVenta(idVenta) {
  const { rows: lineas } = await consultar(
    `SELECT p.nombre, vd.cantidad, vd.precio_unitario_aplicado AS precio,
            vd.cantidad * vd.precio_unitario_aplicado AS subtotal
       FROM venta_detalle vd
       JOIN productos p ON p.id_producto = vd.id_producto
      WHERE vd.id_venta = $1
      ORDER BY vd.id_venta_detalle`,
    [idVenta]
  );
  const { rows: pagos } = await consultar(
    `SELECT m.nombre AS medio, m.afecta_caja_efectivo, pv.monto
       FROM pagos_venta pv
       JOIN medios_pago m ON m.id_medio_pago = pv.id_medio_pago
      WHERE pv.id_venta = $1
      ORDER BY pv.id_pago_venta`,
    [idVenta]
  );
  return { lineas, pagos };
}

async function mostrarAnulacion(res, venta, { errores = [], motivo = '', estado = 200 } = {}) {
  const { lineas, pagos } = await detalleDeVenta(venta.id_venta);
  res.status(estado).render('ventas/anular', {
    venta, lineas, pagos, errores, motivo, CANALES, MOTIVO_MAXIMO,
  });
}

router.get('/:id/anular', async (req, res, siguiente) => {
  try {
    const sucursales = [req.sucursal];
    const venta = await ventaParaAnular(consultar, Number(req.params.id), false);
    const impedimento = motivoParaNoAnular(venta, sucursales, req.carta);
    if (impedimento) {
      req.session.aviso = impedimento;
      return res.redirect(req.carta.base);
    }
    await mostrarAnulacion(res, venta);
  } catch (error) {
    siguiente(error);
  }
});

router.post('/:id/anular', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = [req.sucursal];
    const idVenta = Number(req.params.id);
    const motivo = typeof req.body.motivo === 'string' ? req.body.motivo.trim() : '';

    const resultado = await conTransaccion(async (ejecutar) => {
      const venta = await ventaParaAnular(ejecutar, idVenta, true);
      const impedimento = motivoParaNoAnular(venta, sucursales, req.carta);
      if (impedimento) return { impedimento, venta };

      if (motivo === '') return { venta, error: 'Escribí por qué se anula la venta.' };
      if (motivo.length > MOTIVO_MAXIMO) {
        return { venta, error: 'El motivo es muy largo: resumilo en menos de ' + MOTIVO_MAXIMO + ' letras.' };
      }

      // El stock, los insumos y los tachos los devuelve la base sola, con el
      // trigger que corre al anular.
      await ejecutar(
        `UPDATE ventas
            SET fecha_anulacion = now(), id_usuario_anulacion = $1, motivo_anulacion = $2
          WHERE id_venta = $3`,
        [usuario.id_usuario, motivo, idVenta]
      );

      const { rows: [efectivo] } = await ejecutar(
        `SELECT coalesce(sum(pv.monto), 0) AS monto
           FROM pagos_venta pv
           JOIN medios_pago m ON m.id_medio_pago = pv.id_medio_pago
          WHERE pv.id_venta = $1 AND m.afecta_caja_efectivo`,
        [idVenta]
      );
      return { anulada: true, venta, efectivo: Number(efectivo.monto) };
    });

    if (resultado.impedimento) {
      req.session.aviso = resultado.impedimento;
      return res.redirect(req.carta.base);
    }
    if (resultado.error) {
      return mostrarAnulacion(res, resultado.venta, { errores: [resultado.error], motivo, estado: 400 });
    }

    // Lo que hay que hacer con la plata depende de como se cobro: el efectivo
    // se devuelve del cajon en el momento; lo cobrado con tarjeta o
    // transferencia se devuelve por el mismo medio, fuera del cajon.
    req.session.aviso = 'Venta anulada.' + (resultado.efectivo > 0
      ? ' Devolvele al cliente ' + pesos(resultado.efectivo) + ' en efectivo.'
      : '');
    res.redirect(req.carta.base);
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
