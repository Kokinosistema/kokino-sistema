'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { parsearMonto, MONTO_INVALIDO, pesos, aCentavos } = require('../dinero');
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

// ---------------------------------------------------------------------------
// Alta de categorias y productos
//
// Los duenos agregan categorias (como Cafeteria o Impulsivos) y productos,
// con los mismos datos que tienen los que ya estan cargados. Se puede llegar
// desde Vender o desde esta pantalla; "volver" dice a cual regresar.

// Las tres formas en que sale un producto (productos.tipo_origen).
const ORIGENES = [
  { valor: 'PRODUCIDO_DIRECTO', texto: 'Lo producimos nosotros', ayuda: 'Tortas, impulsivos, cafetería: tiene receta propia.' },
  { valor: 'PRODUCIDO_DESDE_SABOR', texto: 'Se arma con helado', ayuda: 'Térmicos, cucuruchos, familiares: lleva helado de los tachos.' },
  { valor: 'COMPRADO_TERMINADO', texto: 'Lo compramos hecho', ayuda: 'Se compra terminado y se revende.' },
];

function volverA(volver, idCategoria) {
  if (volver === 'ventas') return idCategoria ? '/ventas?categoria=' + idCategoria : '/ventas';
  return '/productos';
}

async function categoriasDeProducto() {
  const { rows } = await consultar(
    "SELECT id_categoria, nombre FROM categorias WHERE tipo = 'PRODUCTO' ORDER BY nombre"
  );
  return rows;
}

router.get('/categorias/nueva', (req, res) => {
  res.render('productos/categoria', { nombre: '', errores: [], volver: req.query.volver === 'ventas' ? 'ventas' : '' });
});

router.post('/categorias', async (req, res, siguiente) => {
  const nombre = (req.body.nombre || '').trim();
  const volver = req.body.volver === 'ventas' ? 'ventas' : '';
  const errores = [];
  if (nombre.length < 2 || nombre.length > 100) errores.push('Poné el nombre de la categoría (de 2 a 100 letras).');
  try {
    if (errores.length === 0) {
      const { rows: iguales } = await consultar(
        "SELECT 1 FROM categorias WHERE tipo = 'PRODUCTO' AND lower(nombre) = lower($1)", [nombre]
      );
      if (iguales.length > 0) errores.push('Ya hay una categoría de productos que se llama ' + nombre + '.');
    }
    if (errores.length > 0) return res.status(400).render('productos/categoria', { nombre, errores, volver });

    const { rows: [categoria] } = await consultar(
      "INSERT INTO categorias (nombre, tipo) VALUES ($1, 'PRODUCTO') RETURNING id_categoria",
      [nombre]
    );
    // Una categoria sin productos no aparece en Vender: se sigue directo a
    // cargarle el primero.
    req.session.aviso = 'Se creó la categoría ' + nombre + '. Ahora agregale su primer producto.';
    res.redirect('/productos/nuevo?categoria=' + categoria.id_categoria + (volver ? '&volver=' + volver : ''));
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).render('productos/categoria', {
        nombre, errores: ['Ya hay una categoría de productos que se llama ' + nombre + '.'], volver,
      });
    }
    siguiente(error);
  }
});

async function mostrarNuevoProducto(res, { producto, errores = [], volver = '', estado = 200 }) {
  const { rows: unidades } = await consultar(
    'SELECT id_unidad, nombre, abreviatura FROM unidades_medida ORDER BY magnitud DESC, factor_a_base, nombre'
  );
  res.status(estado).render('productos/nuevo', {
    producto, errores, volver, ORIGENES, unidades, categorias: await categoriasDeProducto(),
  });
}

router.get('/nuevo', async (req, res, siguiente) => {
  try {
    const { rows: [unidad] } = await consultar("SELECT id_unidad FROM unidades_medida WHERE abreviatura = 'un'");
    await mostrarNuevoProducto(res, {
      producto: {
        nombre: '', id_categoria: Number(req.query.categoria) || '', tipo_origen: '',
        lleva_stock_propio: 'si', id_unidad_medida: unidad ? unidad.id_unidad : '', contenido: '1', precio: '',
      },
      volver: req.query.volver === 'ventas' ? 'ventas' : '',
    });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/', async (req, res, siguiente) => {
  const volver = req.body.volver === 'ventas' ? 'ventas' : '';
  const producto = {
    nombre: (req.body.nombre || '').trim(),
    id_categoria: Number(req.body.id_categoria) || '',
    tipo_origen: req.body.tipo_origen || '',
    lleva_stock_propio: req.body.lleva_stock_propio === 'no' ? 'no' : 'si',
    id_unidad_medida: Number(req.body.id_unidad_medida) || '',
    contenido: (req.body.contenido || '').trim(),
    precio: (req.body.precio || '').trim(),
  };
  try {
    const errores = [];
    if (producto.nombre.length < 2 || producto.nombre.length > 150) errores.push('Poné el nombre del producto.');
    const { rows: categoria } = await consultar(
      "SELECT 1 FROM categorias WHERE id_categoria = $1 AND tipo = 'PRODUCTO'", [producto.id_categoria || null]
    );
    if (categoria.length === 0) errores.push('Elegí la categoría.');
    if (!ORIGENES.some((o) => o.valor === producto.tipo_origen)) errores.push('Elegí de dónde sale el producto.');
    const { rows: unidad } = await consultar(
      'SELECT 1 FROM unidades_medida WHERE id_unidad = $1', [producto.id_unidad_medida || null]
    );
    if (unidad.length === 0) errores.push('Elegí en qué se vende.');
    // El contenido admite coma decimal y tres decimales, como en la base.
    const contenido = /^\d+(,\d{1,3})?$/.test(producto.contenido) ? Number(producto.contenido.replace(',', '.')) : null;
    if (!contenido || contenido <= 0) errores.push('Poné cuánto contiene una unidad: un número mayor que cero (por ejemplo, 1 o 0,250).');
    const precio = parsearMonto(producto.precio, { permitirCero: false });
    if (precio === null) errores.push('Poné el precio de venta: ' + MONTO_INVALIDO + '.');
    if (producto.nombre) {
      const { rows: iguales } = await consultar('SELECT 1 FROM productos WHERE lower(nombre) = lower($1)', [producto.nombre]);
      if (iguales.length > 0) errores.push('Ya hay un producto que se llama ' + producto.nombre + '.');
    }
    if (errores.length > 0) return mostrarNuevoProducto(res, { producto, errores, volver, estado: 400 });

    // El producto y su precio, juntos o nada: un producto sin precio no
    // aparece en Vender.
    await conTransaccion(async (ejecutar) => {
      const { rows: [nuevo] } = await ejecutar(
        `INSERT INTO productos (nombre, id_categoria, tipo_origen, id_unidad_medida, contenido, lleva_stock_propio)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id_producto`,
        [producto.nombre, producto.id_categoria, producto.tipo_origen, producto.id_unidad_medida,
          contenido, producto.lleva_stock_propio === 'si']
      );
      await ejecutar(
        "INSERT INTO precios (id_producto, tipo_precio, precio) VALUES ($1, 'MINORISTA', $2)",
        [nuevo.id_producto, precio]
      );
    });

    req.session.aviso = 'Se agregó ' + producto.nombre + ' a ' + (await nombreDeCategoria(producto.id_categoria))
      + ', a ' + pesos(precio) + '. Ya se puede vender.';
    res.redirect(volverA(volver, producto.id_categoria));
  } catch (error) {
    if (error.code === '23505') {
      return mostrarNuevoProducto(res, {
        producto, errores: ['Ya hay un producto que se llama ' + producto.nombre + '.'], volver, estado: 409,
      });
    }
    siguiente(error);
  }
});

async function nombreDeCategoria(id) {
  const { rows: [c] } = await consultar('SELECT nombre FROM categorias WHERE id_categoria = $1', [id]);
  return c ? c.nombre : 'la categoría';
}

// ---------------------------------------------------------------------------
// Editar los productos de una categoria: nombre y precio
//
// Solo los duenos (todo este router lleva exigirRol). Se guardan todos los
// cambios juntos o ninguno. Un cambio de precio no pisa el anterior: se
// cierra con la fecha de hoy y se abre el nuevo, como pide la tabla precios,
// asi las ventas viejas siguen mostrando el precio al que se vendieron.

async function productosDeCategoria(idCategoria) {
  const { rows } = await consultar(
    `SELECT p.id_producto, p.nombre,
            (SELECT pr.precio FROM precios pr
              WHERE pr.id_producto = p.id_producto AND pr.tipo_precio = 'MINORISTA'
                AND pr.fecha_vigencia_hasta IS NULL) AS precio
       FROM productos p
      WHERE p.id_categoria = $1 AND p.activo
      ORDER BY p.nombre`,
    [idCategoria]
  );
  return rows;
}

async function mostrarEdicion(res, { categoria, filas, errores = [], volver = '', estado = 200 }) {
  res.status(estado).render('productos/editar', { categoria, filas, errores, volver });
}

router.get('/categorias/:id/editar', async (req, res, siguiente) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return siguiente();
    const { rows: [categoria] } = await consultar(
      "SELECT id_categoria, nombre FROM categorias WHERE id_categoria = $1 AND tipo = 'PRODUCTO'", [id]
    );
    if (!categoria) return siguiente();
    const filas = (await productosDeCategoria(id)).map((p) => ({
      id_producto: p.id_producto,
      nombre: p.nombre,
      // El precio se muestra en formato argentino, listo para editar.
      precio: p.precio === null ? '' : pesos(p.precio),
    }));
    await mostrarEdicion(res, { categoria, filas, volver: req.query.volver === 'ventas' ? 'ventas' : '' });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/categorias/:id/editar', async (req, res, siguiente) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return siguiente();
    const volver = req.body.volver === 'ventas' ? 'ventas' : '';
    const { rows: [categoria] } = await consultar(
      "SELECT id_categoria, nombre FROM categorias WHERE id_categoria = $1 AND tipo = 'PRODUCTO'", [id]
    );
    if (!categoria) return siguiente();

    const actuales = await productosDeCategoria(id);
    const porId = new Map(actuales.map((p) => [p.id_producto, p]));

    // Llegan como listas paralelas, un renglon por producto.
    const aLista = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
    const ids = aLista(req.body.id_producto);
    const nombres = aLista(req.body.nombre);
    const precios = aLista(req.body.precio);
    const filas = ids.map((idProducto, i) => ({
      id_producto: Number(idProducto),
      nombre: typeof nombres[i] === 'string' ? nombres[i].trim() : '',
      precio: typeof precios[i] === 'string' ? precios[i].trim() : '',
    }));

    const errores = [];
    const cambios = [];
    const vistos = new Set();
    for (const f of filas) {
      const actual = porId.get(f.id_producto);
      if (!actual) { errores.push('Un producto ya no está en esta categoría: volvé a abrir la pantalla.'); continue; }
      if (f.nombre.length < 2 || f.nombre.length > 150) {
        errores.push('El producto "' + actual.nombre + '" necesita un nombre (de 2 a 150 letras).');
        continue;
      }
      const clave = f.nombre.toLowerCase();
      if (vistos.has(clave)) errores.push('Hay dos productos que se llamarían "' + f.nombre + '".');
      vistos.add(clave);
      const precio = parsearMonto(f.precio);
      if (precio === null) {
        errores.push('El precio de "' + f.nombre + '": ' + MONTO_INVALIDO + '.');
        continue;
      }
      const cambiaNombre = f.nombre !== actual.nombre;
      const cambiaPrecio = actual.precio === null || aCentavos(precio) !== aCentavos(actual.precio);
      if (cambiaNombre || cambiaPrecio) cambios.push({ id: f.id_producto, nombre: f.nombre, precio, cambiaNombre, cambiaPrecio });
    }

    // Un nombre nuevo no puede ser el de otro producto, de esta categoria o de
    // otra. Salvo que ese otro producto tambien cambie de nombre en este mismo
    // guardado: ahi el nombre queda libre.
    const renombrados = new Set(cambios.filter((x) => x.cambiaNombre).map((x) => x.id));
    for (const c of cambios.filter((x) => x.cambiaNombre)) {
      const { rows } = await consultar(
        'SELECT id_producto FROM productos WHERE lower(nombre) = lower($1) AND id_producto <> $2', [c.nombre, c.id]
      );
      if (rows.some((r) => !renombrados.has(r.id_producto))) {
        errores.push('Ya hay otro producto que se llama "' + c.nombre + '".');
      }
    }
    if (errores.length > 0) return mostrarEdicion(res, { categoria, filas, errores, volver, estado: 400 });

    if (cambios.length === 0) {
      req.session.aviso = 'No había nada para cambiar.';
      return res.redirect(volverA(volver, id));
    }

    try {
      await conTransaccion(async (ejecutar) => {
        for (const c of cambios) {
          if (c.cambiaNombre) {
            await ejecutar('UPDATE productos SET nombre = $1 WHERE id_producto = $2', [c.nombre, c.id]);
          }
          if (c.cambiaPrecio) {
            await ejecutar(
              `UPDATE precios SET fecha_vigencia_hasta = current_date
                WHERE id_producto = $1 AND tipo_precio = 'MINORISTA' AND fecha_vigencia_hasta IS NULL`,
              [c.id]
            );
            await ejecutar(
              "INSERT INTO precios (id_producto, tipo_precio, precio) VALUES ($1, 'MINORISTA', $2)",
              [c.id, c.precio]
            );
          }
        }
      });
    } catch (error) {
      // Dos productos que intercambian nombres en el mismo guardado chocan
      // con el nombre unico a mitad de camino: se explica en vez de fallar.
      if (error.code === '23505') {
        return mostrarEdicion(res, {
          categoria, filas, volver, estado: 409,
          errores: ['Dos productos no pueden tener el mismo nombre. Si estás intercambiando nombres, hacelo en dos pasos.'],
        });
      }
      throw error;
    }

    req.session.aviso = (cambios.length === 1 ? 'Se guardó el cambio de 1 producto' : 'Se guardaron los cambios de ' + cambios.length + ' productos')
      + ' de ' + categoria.nombre + '.';
    res.redirect(volverA(volver, id));
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
