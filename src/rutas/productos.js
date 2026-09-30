'use strict';

const express = require('express');
const { consultar } = require('../db');
const { exigirRol } = require('../middleware/sesion');

const router = express.Router();

// Definir que lleva cada producto es configuracion del negocio: de eso
// depende cuanto stock de insumos descuenta cada venta. Lo hacen los duenos.
router.use(exigirRol('administrador'));

router.get('/', async (req, res, siguiente) => {
  try {
    const { rows } = await consultar(
      `SELECT p.id_producto, p.nombre, p.activo, p.lleva_stock_propio, c.nombre AS categoria,
              -- El stock es de cada sucursal: el de la sucursal de trabajo.
              -- Los que se arman al vender (un termico, un cafe) no tienen
              -- stock propio: lo suyo se descuenta de tachos e insumos.
              coalesce((SELECT sum(m.cantidad) FROM movimientos_producto m
                         WHERE m.id_producto = p.id_producto AND m.id_sucursal = $1), 0) AS stock
         FROM productos p
         JOIN categorias c ON c.id_categoria = p.id_categoria
        -- Solo lo que tiene stock propio. Lo que se arma al vender (termicos,
        -- cucuruchos, cafeteria) no: lo que se cuenta de eso es el envase, el
        -- cucurucho o el cafe, que son insumos y se ven en Insumos.
        WHERE p.lleva_stock_propio
        ORDER BY c.nombre, p.nombre`,
      [req.sucursal.id_sucursal]
    );
    const grupos = [];
    for (const producto of rows) {
      let grupo = grupos[grupos.length - 1];
      if (!grupo || grupo.categoria !== producto.categoria) {
        grupo = { categoria: producto.categoria, productos: [] };
        grupos.push(grupo);
      }
      grupo.productos.push(producto);
    }
    // La lista muestra solo el producto y su stock; que insumos lleva se ve
    // y se carga entrando a cada producto.
    res.render('productos/lista', { grupos });
  } catch (error) {
    siguiente(error);
  }
});

async function mostrarProducto(req, res, siguiente, { errores = [], elegido = {}, estado = 200 } = {}) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return siguiente();

  const { rows: [producto] } = await consultar(
    `SELECT p.id_producto, p.nombre, p.activo, p.lleva_stock_propio, c.nombre AS categoria
       FROM productos p
       JOIN categorias c ON c.id_categoria = p.id_categoria
      WHERE p.id_producto = $1`,
    [id]
  );
  if (!producto) return siguiente();

  const { rows: lleva } = await consultar(
    `SELECT pi.id_insumo, i.nombre, pi.cantidad, u.abreviatura AS unidad, i.activo
       FROM producto_insumos pi
       JOIN insumos i ON i.id_insumo = pi.id_insumo
       JOIN unidades_medida u ON u.id_unidad = pi.id_unidad_medida
      WHERE pi.id_producto = $1
      ORDER BY i.nombre`,
    [id]
  );
  const { rows: insumos } = await consultar(
    `SELECT i.id_insumo, i.nombre, c.nombre AS categoria, u.abreviatura AS unidad, i.id_unidad_medida
       FROM insumos i
       JOIN categorias c ON c.id_categoria = i.id_categoria
       JOIN unidades_medida u ON u.id_unidad = i.id_unidad_medida
      WHERE i.activo
      ORDER BY c.nombre, i.nombre`
  );
  const { rows: unidades } = await consultar(
    'SELECT id_unidad, nombre, abreviatura FROM unidades_medida ORDER BY magnitud, factor_a_base, nombre'
  );

  res.status(estado).render('productos/insumos', {
    producto, lleva, insumos, unidades, errores, elegido,
  });
}

router.get('/:id', async (req, res, siguiente) => {
  try {
    await mostrarProducto(req, res, siguiente);
  } catch (error) {
    siguiente(error);
  }
});

// Agrega un insumo al producto, o le cambia la cantidad si ya lo tenia: en
// un producto cada insumo aparece una sola vez.
router.post('/:id/insumos', async (req, res, siguiente) => {
  try {
    const idProducto = Number(req.params.id);
    if (!Number.isInteger(idProducto)) return siguiente();
    const elegido = {
      id_insumo: Number(req.body.id_insumo),
      cantidad: (req.body.cantidad || '').trim(),
      id_unidad_medida: Number(req.body.id_unidad_medida),
    };

    const errores = [];
    if (!/^\d+(\.\d{1,3})?$/.test(elegido.cantidad) || Number(elegido.cantidad) <= 0) {
      errores.push('La cantidad tiene que ser un número mayor que cero, con tres decimales como mucho.');
    }

    // La misma regla que hace cumplir la base (misma magnitud, y en conteo
    // la misma unidad), chequeada antes para explicarla con palabras de
    // quien carga y no con el mensaje de PostgreSQL.
    const { rows: [datos] } = await consultar(
      `SELECT i.nombre, i.activo, uc.nombre AS compra, uc.magnitud AS magnitud_compra, i.id_unidad_medida AS id_compra,
              ur.nombre AS pedida, ur.magnitud AS magnitud_pedida
         FROM insumos i
         JOIN unidades_medida uc ON uc.id_unidad = i.id_unidad_medida
         JOIN unidades_medida ur ON ur.id_unidad = $2
        WHERE i.id_insumo = $1`,
      [elegido.id_insumo, elegido.id_unidad_medida]
    );
    if (!datos || !datos.activo) {
      errores.push('Elegí un insumo de la lista y una unidad.');
    } else if (datos.magnitud_compra !== datos.magnitud_pedida) {
      errores.push(datos.nombre + ' se compra en ' + datos.compra.toLowerCase() + ', así que no se puede cargar en '
        + datos.pedida.toLowerCase() + ': son medidas distintas. Elegí una unidad de '
        + { PESO: 'peso (gramos o kilos)', VOLUMEN: 'volumen (litros)', CONTEO: 'conteo' }[datos.magnitud_compra] + '.');
    } else if (datos.magnitud_compra === 'CONTEO' && datos.id_compra !== elegido.id_unidad_medida) {
      errores.push(datos.nombre + ' se compra por ' + datos.compra.toLowerCase() + ', así que se carga en '
        + datos.compra.toLowerCase() + ': no hay equivalencia entre ' + datos.compra.toLowerCase()
        + ' y ' + datos.pedida.toLowerCase() + '.');
    }
    if (errores.length > 0) return mostrarProducto(req, res, siguiente, { errores, elegido, estado: 400 });

    const { rows: [resultado] } = await consultar(
      `INSERT INTO producto_insumos (id_producto, id_insumo, cantidad, id_unidad_medida)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_producto, id_insumo)
       DO UPDATE SET cantidad = EXCLUDED.cantidad, id_unidad_medida = EXCLUDED.id_unidad_medida
       RETURNING (xmax = 0) AS nuevo`,
      [idProducto, elegido.id_insumo, elegido.cantidad, elegido.id_unidad_medida]
    );
    req.session.aviso = (resultado.nuevo ? 'Se agregó ' : 'Se actualizó la cantidad de ') + datos.nombre + '.';
    res.redirect('/productos/' + idProducto);
  } catch (error) {
    // El producto no existe: la clave foranea lo frena.
    if (error.code === '23503') return siguiente();
    siguiente(error);
  }
});

// Sacar un insumo solo cambia lo que descuentan las ventas de aca en
// adelante: los movimientos de las ventas ya hechas quedan como estaban.
router.post('/:id/insumos/:insumo/quitar', async (req, res, siguiente) => {
  try {
    const idProducto = Number(req.params.id);
    const idInsumo = Number(req.params.insumo);
    if (!Number.isInteger(idProducto) || !Number.isInteger(idInsumo)) return siguiente();
    const { rows } = await consultar(
      `DELETE FROM producto_insumos pi
        USING insumos i
        WHERE i.id_insumo = pi.id_insumo AND pi.id_producto = $1 AND pi.id_insumo = $2
        RETURNING i.nombre`,
      [idProducto, idInsumo]
    );
    req.session.aviso = rows.length ? 'Se sacó ' + rows[0].nombre + '.' : 'Ese insumo ya no estaba en el producto.';
    res.redirect('/productos/' + idProducto);
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
