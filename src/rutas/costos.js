'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { exigirRol } = require('../middleware/sesion');
const { parsearMonto, MONTO_INVALIDO, aCentavos } = require('../dinero');

const router = express.Router();

// Costos que cargan los duenos (2026-10-05): lo que cuesta cada producto que
// se revende y cada insumo, por su unidad de compra. Como los precios, un
// costo nuevo cierra el anterior y rige desde hoy, asi queda el historial.
//
// El costo de lo que se fabrica no se carga aca: sale de su receta y del
// costo de sus insumos.
router.use(exigirRol('administrador'));

async function filas() {
  const { rows: productos } = await consultar(
    `SELECT p.id_producto AS id, p.nombre, c.nombre AS categoria, lower(u.abreviatura) AS unidad,
            co.costo, co.fecha_vigencia_desde AS desde, pr.precio
       FROM productos p
       JOIN categorias c ON c.id_categoria = p.id_categoria
       JOIN unidades_medida u ON u.id_unidad = p.id_unidad_medida
       LEFT JOIN costos_producto co ON co.id_producto = p.id_producto AND co.fecha_vigencia_hasta IS NULL
       LEFT JOIN precios pr ON pr.id_producto = p.id_producto AND pr.tipo_precio = 'MINORISTA' AND pr.fecha_vigencia_hasta IS NULL
      WHERE p.activo AND p.tipo_origen = 'COMPRADO_TERMINADO'
      ORDER BY c.nombre, p.nombre`
  );
  const { rows: insumos } = await consultar(
    `SELECT i.id_insumo AS id, i.nombre, c.nombre AS categoria, lower(u.abreviatura) AS unidad,
            co.costo, co.fecha_vigencia_desde AS desde
       FROM insumos i
       JOIN categorias c ON c.id_categoria = i.id_categoria
       JOIN unidades_medida u ON u.id_unidad = i.id_unidad_medida
       LEFT JOIN costos_insumo co ON co.id_insumo = i.id_insumo AND co.fecha_vigencia_hasta IS NULL
      WHERE i.activo
      ORDER BY c.nombre, i.nombre`
  );
  const conNumeros = (f) => ({ ...f, costo: f.costo === null ? null : Number(f.costo), precio: f.precio == null ? null : Number(f.precio) });
  return { productos: productos.map(conNumeros), insumos: insumos.map(conNumeros) };
}

async function historial() {
  const { rows } = await consultar(
    `(SELECT 'Producto' AS tipo, p.nombre, co.costo, co.fecha_vigencia_desde AS desde, co.fecha_vigencia_hasta AS hasta, co.created_at
        FROM costos_producto co JOIN productos p ON p.id_producto = co.id_producto)
     UNION ALL
     (SELECT 'Insumo', i.nombre, co.costo, co.fecha_vigencia_desde, co.fecha_vigencia_hasta, co.created_at
        FROM costos_insumo co JOIN insumos i ON i.id_insumo = co.id_insumo)
     ORDER BY created_at DESC
     LIMIT 15`
  );
  return rows;
}

async function mostrar(res, { valores = {}, errores = [], estado = 200 } = {}) {
  res.status(estado).render('costos/index', { ...(await filas()), historial: await historial(), valores, errores });
}

router.get('/', async (req, res, siguiente) => {
  try {
    await mostrar(res);
  } catch (error) {
    siguiente(error);
  }
});

// Productos e insumos se guardan con el mismo formulario: cada campo se
// llama producto_<id> o insumo_<id>. Solo se guarda lo que cambio. Un campo
// vacio deja sin costo lo que nunca tuvo; lo que ya tenia no se puede vaciar.
const TIPOS = {
  producto: { tabla: 'costos_producto', columna: 'id_producto', texto: 'producto' },
  insumo: { tabla: 'costos_insumo', columna: 'id_insumo', texto: 'insumo' },
};

router.post('/', async (req, res, siguiente) => {
  try {
    const { productos, insumos } = await filas();
    const valores = {};
    const errores = [];
    const cambios = [];
    const revisar = (tipo, lista) => {
      for (const f of lista) {
        const clave = tipo + '_' + f.id;
        if (typeof req.body[clave] !== 'string') continue;
        const texto = req.body[clave].trim();
        valores[clave] = texto;
        if (texto === '') {
          if (f.costo !== null) errores.push('El costo de "' + f.nombre + '" no se puede dejar vacío: poné el costo nuevo.');
          continue;
        }
        const costo = parsearMonto(texto, { permitirCero: true });
        if (costo === null) { errores.push('El costo de "' + f.nombre + '": ' + MONTO_INVALIDO + '.'); continue; }
        if (f.costo === null || aCentavos(f.costo) !== aCentavos(costo)) cambios.push({ tipo, id: f.id, costo });
      }
    };
    revisar('producto', productos);
    revisar('insumo', insumos);
    if (errores.length > 0) return mostrar(res, { valores, errores, estado: 400 });
    if (cambios.length === 0) {
      req.session.aviso = 'No había ningún costo para cambiar.';
      return res.redirect('/costos');
    }
    await conTransaccion(async (ejecutar) => {
      for (const c of cambios) {
        const t = TIPOS[c.tipo];
        await ejecutar(
          `UPDATE ${t.tabla} SET fecha_vigencia_hasta = current_date WHERE ${t.columna} = $1 AND fecha_vigencia_hasta IS NULL`,
          [c.id]
        );
        await ejecutar(`INSERT INTO ${t.tabla} (${t.columna}, costo) VALUES ($1, $2)`, [c.id, c.costo]);
      }
    });
    req.session.aviso = cambios.length === 1 ? 'Se guardó el costo nuevo. Rige desde hoy.' : 'Se guardaron ' + cambios.length + ' costos nuevos. Rigen desde hoy.';
    res.redirect('/costos');
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
