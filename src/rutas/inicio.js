'use strict';

const express = require('express');
const { consultar } = require('../db');

const router = express.Router();

// Pantalla de inicio. Por ahora solo confirma quien entro y sobre que
// sucursal va a operar, que es justo lo que hay que poder ver funcionando
// antes de construir cualquier otra pantalla encima.
router.get('/', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;

    // Los duenos ven las dos sucursales; el empleado, solo la suya. Este mismo
    // filtro se va a repetir en ventas, caja y stock, asi que conviene que la
    // regla quede escrita en un solo lugar cuando crezca.
    const esAdministrador = usuario.rol === 'administrador';

    const { rows } = await consultar(
      `SELECT s.nombre,
              s.direccion,
              (SELECT count(*) FROM empleados e
                WHERE e.id_sucursal_asignada = s.id_sucursal AND e.activo)::int AS empleados
         FROM sucursales s
        WHERE $1 OR s.id_sucursal = $2
        ORDER BY s.nombre`,
      [esAdministrador, usuario.id_sucursal_asignada]
    );

    const { rows: totales } = await consultar(
      `SELECT (SELECT count(*) FROM productos WHERE activo)::int   AS productos,
              (SELECT count(*) FROM sabores)::int                  AS sabores,
              (SELECT count(*) FROM insumos)::int                  AS insumos,
              (SELECT count(*) FROM recetas)::int                  AS recetas`
    );

    res.render('inicio', { sucursales: rows, totales: totales[0] });
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
