'use strict';

// La carta de PedidosYa: que productos se venden por la plataforma y a que
// precio (pedido de la usuaria el 2026-10-15). Vender por PedidosYa lo hace
// el router de ventas, montado tambien en /pedidosya (ver src/cartas.js);
// aca esta solo lo de los duenos: editar precios, sumar y sacar productos.
//
// En PedidosYa no se crean productos: el familiar que sale por la
// plataforma es el mismo del mostrador, con el mismo stock e insumos. Lo
// unico propio es el precio (tipo PEDIDOSYA en la tabla precios), y tenerlo
// vigente es lo que pone al producto en la carta. Por eso tampoco se edita
// el nombre desde aca: cambiaria tambien en el mostrador.

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { parsearMonto, MONTO_INVALIDO, pesos, aCentavos } = require('../dinero');
const { exigirRol } = require('../middleware/sesion');

const router = express.Router();

// Va en cada ruta y no con router.use: este router se monta en /pedidosya
// antes que el de ventas, y un router.use frenaria tambien a los empleados
// que entran a vender.
const soloDuenos = exigirRol('administrador');

async function categoriaDeProductos(id) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const { rows: [categoria] } = await consultar(
    "SELECT id_categoria, nombre FROM categorias WHERE id_categoria = $1 AND tipo = 'PRODUCTO'", [id]
  );
  return categoria || null;
}

// Los productos activos, con su precio de PedidosYa (null si no estan en la
// carta) y el de mostrador, para tenerlo de referencia. De una categoria, o
// de todas (sin idCategoria) en el orden de la pantalla de Vender.
async function productos(idCategoria = null) {
  const { rows } = await consultar(
    `SELECT p.id_producto, p.nombre, c.id_categoria, c.nombre AS categoria,
            (SELECT pr.precio FROM precios pr
              WHERE pr.id_producto = p.id_producto AND pr.tipo_precio = 'PEDIDOSYA'
                AND pr.fecha_vigencia_hasta IS NULL) AS precio,
            (SELECT pr.precio FROM precios pr
              WHERE pr.id_producto = p.id_producto AND pr.tipo_precio = 'MINORISTA'
                AND pr.fecha_vigencia_hasta IS NULL) AS precio_mostrador
       FROM productos p
       JOIN categorias c ON c.id_categoria = p.id_categoria
      WHERE p.activo AND ($1::int IS NULL OR p.id_categoria = $1)
      ORDER BY c.orden NULLS LAST, c.nombre, p.nombre`,
    [idCategoria]
  );
  return rows;
}

// Un precio nuevo no pisa al anterior: se cierra el vigente y se abre otro,
// igual que en el mostrador, para que las ventas pasadas conserven el suyo.
async function cerrarPrecio(ejecutar, idProducto) {
  await ejecutar(
    `UPDATE precios SET fecha_vigencia_hasta = current_date
      WHERE id_producto = $1 AND tipo_precio = 'PEDIDOSYA' AND fecha_vigencia_hasta IS NULL`,
    [idProducto]
  );
}

async function abrirPrecio(ejecutar, idProducto, precio) {
  await ejecutar(
    "INSERT INTO precios (id_producto, tipo_precio, precio) VALUES ($1, 'PEDIDOSYA', $2)",
    [idProducto, precio]
  );
}

const volverA = (idCategoria) => '/pedidosya?categoria=' + idCategoria;

// ---------------------------------------------------------------------------
// Editar los precios de una categoria, y sacar productos de la carta

async function mostrarEdicion(res, { categoria, filas, errores = [], estado = 200 }) {
  res.status(estado).render('pedidosya/editar', { categoria, filas, errores, volver: volverA(categoria.id_categoria) });
}

router.get('/categorias/:id/editar', soloDuenos, async (req, res, siguiente) => {
  try {
    const categoria = await categoriaDeProductos(Number(req.params.id));
    if (!categoria) return siguiente();
    const filas = (await productos(categoria.id_categoria))
      .filter((p) => p.precio !== null)
      .map((p) => ({ ...p, precio: pesos(p.precio) }));
    await mostrarEdicion(res, { categoria, filas });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/categorias/:id/editar', soloDuenos, async (req, res, siguiente) => {
  try {
    const categoria = await categoriaDeProductos(Number(req.params.id));
    if (!categoria) return siguiente();
    const actuales = (await productos(categoria.id_categoria)).filter((p) => p.precio !== null);
    const porId = new Map(actuales.map((p) => [p.id_producto, p]));

    // Sacar un producto de la carta: llega con el boton "Sacar" de su renglon.
    // Se cierra su precio de PedidosYa; el producto sigue en el mostrador.
    if (req.body.sacar !== undefined) {
      const producto = porId.get(Number(req.body.sacar));
      if (!producto) {
        req.session.aviso = 'Ese producto ya no estaba en PedidosYa.';
      } else {
        await conTransaccion((ejecutar) => cerrarPrecio(ejecutar, producto.id_producto));
        req.session.aviso = producto.nombre + ' ya no se vende por PedidosYa. En el mostrador sigue igual.';
        // Si era el ultimo de la categoria, la categoria deja de aparecer en
        // PedidosYa: no hay nada que editar ahi, se vuelve al inicio.
        if (actuales.length === 1) return res.redirect('/pedidosya');
      }
      return res.redirect('/pedidosya/categorias/' + categoria.id_categoria + '/editar');
    }

    // Llegan como listas paralelas, un renglon por producto.
    const aLista = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
    const ids = aLista(req.body.id_producto);
    const precios = aLista(req.body.precio);
    const filas = ids.map((idProducto, i) => {
      const actual = porId.get(Number(idProducto));
      return {
        id_producto: Number(idProducto),
        nombre: actual ? actual.nombre : '',
        precio_mostrador: actual ? actual.precio_mostrador : null,
        precio: typeof precios[i] === 'string' ? precios[i].trim() : '',
      };
    });

    const errores = [];
    const cambios = [];
    for (const f of filas) {
      const actual = porId.get(f.id_producto);
      if (!actual) { errores.push('Un producto ya no está en PedidosYa: volvé a abrir la pantalla.'); continue; }
      const precio = parsearMonto(f.precio);
      if (precio === null) {
        errores.push('El precio de "' + actual.nombre + '": ' + MONTO_INVALIDO + '.');
        continue;
      }
      if (aCentavos(precio) !== aCentavos(actual.precio)) cambios.push({ id: f.id_producto, precio });
    }
    if (errores.length > 0) return mostrarEdicion(res, { categoria, filas, errores, estado: 400 });

    if (cambios.length === 0) {
      req.session.aviso = 'No había nada para cambiar.';
      return res.redirect(volverA(categoria.id_categoria));
    }

    await conTransaccion(async (ejecutar) => {
      for (const c of cambios) {
        await cerrarPrecio(ejecutar, c.id);
        await abrirPrecio(ejecutar, c.id, c.precio);
      }
    });

    req.session.aviso = (cambios.length === 1 ? 'Se guardó el precio de 1 producto' : 'Se guardaron los precios de ' + cambios.length + ' productos')
      + ' de ' + categoria.nombre + ' en PedidosYa.';
    res.redirect(volverA(categoria.id_categoria));
  } catch (error) {
    siguiente(error);
  }
});

// ---------------------------------------------------------------------------
// Sumar a la carta un producto que ya existe
//
// Una sola pantalla para todas las categorias, a la que se llega desde la
// tarjeta "Sumar a PedidosYa" del inicio: asi no hace falta mostrar las
// categorias que no tienen nada en la carta (ver src/cartas.js).

async function mostrarAgregar(res, { elegido = {}, errores = [], estado = 200 }) {
  // Los que todavia no estan en la carta, agrupados por categoria.
  const grupos = [];
  for (const p of (await productos()).filter((x) => x.precio === null)) {
    let grupo = grupos[grupos.length - 1];
    if (!grupo || grupo.id_categoria !== p.id_categoria) {
      grupo = { id_categoria: p.id_categoria, categoria: p.categoria, productos: [] };
      grupos.push(grupo);
    }
    grupo.productos.push(p);
  }
  res.status(estado).render('pedidosya/agregar', { grupos, elegido, errores });
}

router.get('/agregar', soloDuenos, async (req, res, siguiente) => {
  try {
    await mostrarAgregar(res, {});
  } catch (error) {
    siguiente(error);
  }
});

router.post('/agregar', soloDuenos, async (req, res, siguiente) => {
  try {
    const elegido = {
      id_producto: Number(req.body.id_producto) || '',
      precio: typeof req.body.precio === 'string' ? req.body.precio.trim() : '',
    };

    const producto = (await productos()).find((p) => p.id_producto === elegido.id_producto);
    const precio = parsearMonto(elegido.precio);
    const errores = [];
    if (!producto) errores.push('Elegí qué producto se suma a PedidosYa.');
    // Pasa si la pantalla quedo abierta mientras otro dueno lo sumaba.
    else if (producto.precio !== null) errores.push(producto.nombre + ' ya está en PedidosYa: su precio se cambia desde Editar precios.');
    if (precio === null) errores.push('El precio en PedidosYa: ' + MONTO_INVALIDO + '.');
    if (errores.length > 0) return mostrarAgregar(res, { elegido, errores, estado: 400 });

    try {
      await conTransaccion((ejecutar) => abrirPrecio(ejecutar, producto.id_producto, precio));
    } catch (error) {
      // Otro dueno lo sumo justo antes: el indice de un precio vigente por
      // producto y tipo no deja cargar el segundo.
      if (error.code === '23505') {
        return mostrarAgregar(res, {
          elegido, estado: 409, errores: [producto.nombre + ' ya estaba en PedidosYa.'],
        });
      }
      throw error;
    }

    // Se vuelve a la categoria del producto, para verlo ya en la carta.
    req.session.aviso = 'Se sumó ' + producto.nombre + ' a PedidosYa a ' + pesos(precio) + '.';
    res.redirect(volverA(producto.id_categoria));
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
