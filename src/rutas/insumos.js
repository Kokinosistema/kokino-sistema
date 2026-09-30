'use strict';

const express = require('express');
const { consultar } = require('../db');
const { exigirRol } = require('../middleware/sesion');

const router = express.Router();

// Dar de alta insumos es configuracion del negocio, igual que los
// proveedores: lo hacen los duenos. El empleado los usa (vende productos que
// los descuentan), pero no los define.
router.use(exigirRol('administrador'));

// Las categorias y unidades posibles salen de la base, no de una lista fija:
// son datos del negocio y pueden crecer.
async function opciones() {
  const { rows: categorias } = await consultar(
    "SELECT id_categoria, nombre FROM categorias WHERE tipo = 'INSUMO' ORDER BY nombre"
  );
  const { rows: unidades } = await consultar(
    'SELECT id_unidad, nombre, abreviatura FROM unidades_medida ORDER BY magnitud, factor_a_base, nombre'
  );
  return { categorias, unidades };
}

async function leerFormulario(cuerpo) {
  const { categorias, unidades } = await opciones();
  const datos = {
    nombre: (cuerpo.nombre || '').trim(),
    id_categoria: Number(cuerpo.id_categoria),
    id_unidad_medida: Number(cuerpo.id_unidad_medida),
    stock_minimo: (cuerpo.stock_minimo || '').trim() || '0',
    perecedero: cuerpo.perecedero === '1',
  };
  const errores = [];

  if (datos.nombre.length < 2) errores.push('Poné el nombre del insumo.');
  if (datos.nombre.length > 150) errores.push('El nombre es muy largo: 150 letras como mucho.');
  if (!categorias.some((c) => c.id_categoria === datos.id_categoria)) errores.push('Elegí una categoría.');
  if (!unidades.some((u) => u.id_unidad === datos.id_unidad_medida)) errores.push('Elegí en qué unidad se compra.');
  if (!/^\d+(\.\d{1,3})?$/.test(datos.stock_minimo)) {
    errores.push('El stock mínimo tiene que ser un número de cero para arriba, con tres decimales como mucho.');
  }
  return { datos, errores, categorias, unidades };
}

function mostrarFormulario(res, { insumo, errores = [], esNuevo, categorias, unidades, estado = 200 }) {
  res.status(estado).render('insumos/formulario', { insumo, errores, esNuevo, categorias, unidades });
}

// Traduce los errores de la base que tienen explicacion para quien carga:
// el nombre repetido, y el cambio de unidad que dejaria incompatible un
// producto o receta que ya usa el insumo (el mensaje de ese trigger esta
// escrito para leerse tal cual).
function errorConocido(error) {
  if (error.code === '23505') return 'Ya hay otro insumo con ese nombre.';
  if (error.code === 'P0001' && /usado en/.test(error.message)) {
    return error.message + '. Corregí primero ese producto o receta, o dejá la unidad como estaba.';
  }
  return null;
}

router.get('/', async (req, res, siguiente) => {
  try {
    const mostrarInactivos = req.query.inactivos === '1';
    const { rows } = await consultar(
      `SELECT i.id_insumo, i.nombre, i.stock_minimo, i.perecedero, i.activo,
              c.nombre AS categoria, u.abreviatura AS unidad,
              (SELECT count(*) FROM producto_insumos pi WHERE pi.id_insumo = i.id_insumo)::int AS en_productos,
              (SELECT count(*) FROM receta_detalle rd WHERE rd.id_insumo = i.id_insumo)::int AS en_recetas,
              -- El catalogo de insumos es uno solo, pero el stock es de cada
              -- sucursal: se muestra el de la sucursal de trabajo. Es la suma
              -- de sus movimientos, igual que en alertas_stock_negativo.
              coalesce((SELECT sum(m.cantidad) FROM movimientos_insumo m
                         WHERE m.id_insumo = i.id_insumo AND m.id_sucursal = $2), 0) AS stock
         FROM insumos i
         JOIN categorias c ON c.id_categoria = i.id_categoria
         JOIN unidades_medida u ON u.id_unidad = i.id_unidad_medida
        WHERE $1 OR i.activo
        ORDER BY c.nombre, i.activo DESC, i.nombre`,
      [mostrarInactivos, req.sucursal.id_sucursal]
    );

    // Agrupados por categoria, como en la pantalla de ventas.
    const grupos = [];
    for (const insumo of rows) {
      let grupo = grupos[grupos.length - 1];
      if (!grupo || grupo.categoria !== insumo.categoria) {
        grupo = { categoria: insumo.categoria, insumos: [] };
        grupos.push(grupo);
      }
      grupo.insumos.push(insumo);
    }
    res.render('insumos/lista', { grupos, mostrarInactivos });
  } catch (error) {
    siguiente(error);
  }
});

router.get('/nuevo', async (req, res, siguiente) => {
  try {
    const { categorias, unidades } = await opciones();
    // Si se llega desde una categoria de la lista, ya viene elegida.
    const insumo = {
      nombre: '', id_categoria: Number(req.query.categoria) || null,
      id_unidad_medida: null, stock_minimo: '0', perecedero: false,
    };
    mostrarFormulario(res, { insumo, esNuevo: true, categorias, unidades });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/', async (req, res, siguiente) => {
  try {
    const { datos, errores, categorias, unidades } = await leerFormulario(req.body);
    if (errores.length > 0) {
      return mostrarFormulario(res, { insumo: datos, errores, esNuevo: true, categorias, unidades, estado: 400 });
    }
    try {
      await consultar(
        `INSERT INTO insumos (nombre, id_categoria, id_unidad_medida, stock_minimo, perecedero)
         VALUES ($1, $2, $3, $4, $5)`,
        [datos.nombre, datos.id_categoria, datos.id_unidad_medida, datos.stock_minimo, datos.perecedero]
      );
    } catch (error) {
      const mensaje = errorConocido(error);
      if (!mensaje) throw error;
      return mostrarFormulario(res, { insumo: datos, errores: [mensaje], esNuevo: true, categorias, unidades, estado: 409 });
    }
    req.session.aviso = 'Se agregó el insumo ' + datos.nombre + '.';
    res.redirect('/insumos');
  } catch (error) {
    siguiente(error);
  }
});

router.get('/:id/editar', async (req, res, siguiente) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return siguiente();
    const { rows } = await consultar('SELECT * FROM insumos WHERE id_insumo = $1', [id]);
    if (rows.length === 0) return siguiente();
    const { categorias, unidades } = await opciones();
    mostrarFormulario(res, { insumo: rows[0], esNuevo: false, categorias, unidades });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/:id', async (req, res, siguiente) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return siguiente();
    const { datos, errores, categorias, unidades } = await leerFormulario(req.body);
    const insumo = Object.assign({ id_insumo: id }, datos);
    if (errores.length > 0) {
      return mostrarFormulario(res, { insumo, errores, esNuevo: false, categorias, unidades, estado: 400 });
    }
    let rowCount;
    try {
      ({ rowCount } = await consultar(
        `UPDATE insumos
            SET nombre = $1, id_categoria = $2, id_unidad_medida = $3, stock_minimo = $4, perecedero = $5
          WHERE id_insumo = $6`,
        [datos.nombre, datos.id_categoria, datos.id_unidad_medida, datos.stock_minimo, datos.perecedero, id]
      ));
    } catch (error) {
      const mensaje = errorConocido(error);
      if (!mensaje) throw error;
      return mostrarFormulario(res, { insumo, errores: [mensaje], esNuevo: false, categorias, unidades, estado: 409 });
    }
    if (rowCount === 0) return siguiente();
    req.session.aviso = 'Se guardaron los cambios de ' + datos.nombre + '.';
    res.redirect('/insumos');
  } catch (error) {
    siguiente(error);
  }
});

// Baja logica, no borrado: un insumo que ya se uso tiene movimientos de
// stock que lo nombran. Lo que se apaga es que aparezca para cargar en
// productos y recetas nuevos.
router.post('/:id/baja', async (req, res, siguiente) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return siguiente();
    const activar = req.body.activar === '1';
    const { rows } = await consultar(
      'UPDATE insumos SET activo = $1 WHERE id_insumo = $2 RETURNING nombre',
      [activar, id]
    );
    if (rows.length === 0) return siguiente();
    req.session.aviso = activar
      ? rows[0].nombre + ' vuelve a estar disponible.'
      : rows[0].nombre + ' ya no va a aparecer para cargar en productos y recetas.';
    res.redirect('/insumos' + (activar ? '' : '?inactivos=1'));
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
