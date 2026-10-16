'use strict';

const express = require('express');
const { consultar } = require('../db');
const { metricasDelDueno, alertasDeStock } = require('../metricas');
const { avisoDeCopias } = require('../copias');
const { primerosPasos } = require('../primeros-pasos');

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

    // Las metricas de ventas son solo para los duenos: a los empleados ni se
    // les calculan.
    const metricas = req.session.usuario.rol === 'administrador'
      ? await metricasDelDueno(req.sucursal.id_sucursal)
      : null;

    // Los duenos ven si la copia de seguridad diaria fallo o es vieja.
    const avisoCopias = req.session.usuario.rol === 'administrador' ? avisoDeCopias() : null;

    // El empleado ve lo que le sirve para el turno (2026-10-07): como esta la
    // caja, accesos grandes a lo que usa, y el helado que se esta terminando
    // o esta por vencer en su sucursal. Sin plata: el total del dia es de los
    // duenos.
    let mostrador = null;
    if (!metricas) {
      const { rows: [caja] } = await consultar(
        `SELECT c.fecha_apertura, t.nombre AS turno,
                (SELECT count(*) FROM ventas v WHERE v.id_caja = c.id_caja AND v.fecha_anulacion IS NULL)::int AS ventas
           FROM cajas c JOIN turnos t ON t.codigo = c.turno
          WHERE c.id_sucursal = $1 AND c.fecha_cierre IS NULL`,
        [req.sucursal.id_sucursal]
      );
      mostrador = { caja: caja || null, alertas: await alertasDeStock(req.sucursal.id_sucursal) };
    }

    // La guia de lo que falta cargar, para los duenos, hasta que este todo.
    const guia = metricas ? await primerosPasos() : null;

    res.render('inicio', { sucursales: rows, metricas, avisoCopias, mostrador, guia });
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
