'use strict';

const express = require('express');
const { consultar } = require('../db');
const { metricasDelDueno } = require('../metricas');

const router = express.Router();

// Pantalla de inicio. Por ahora solo confirma quien entro y sobre que
// sucursal va a operar, que es justo lo que hay que poder ver funcionando
// antes de construir cualquier otra pantalla encima.
router.get('/', async (req, res, siguiente) => {
  try {
    // La sucursal de trabajo: la del empleado, o la que el dueno eligio
    // arriba. Esa regla ya quedo escrita en un solo lugar, src/sucursales.js.
    const { rows } = await consultar(
      `SELECT s.nombre,
              s.direccion,
              (SELECT count(*) FROM empleados e
                WHERE e.id_sucursal_asignada = s.id_sucursal AND e.activo)::int AS empleados
         FROM sucursales s
        WHERE s.id_sucursal = $1`,
      [req.sucursal.id_sucursal]
    );

    const { rows: totales } = await consultar(
      `SELECT (SELECT count(*) FROM productos WHERE activo)::int   AS productos,
              (SELECT count(*) FROM sabores)::int                  AS sabores,
              (SELECT count(*) FROM insumos)::int                  AS insumos,
              (SELECT count(*) FROM recetas)::int                  AS recetas`
    );

    // Las metricas de ventas son solo para los duenos: a los empleados ni se
    // les calculan.
    const metricas = req.session.usuario.rol === 'administrador'
      ? await metricasDelDueno(req.sucursal.id_sucursal)
      : null;

    res.render('inicio', { sucursales: rows, totales: totales[0], metricas });
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
