'use strict';

const express = require('express');
const { consultar } = require('../db');
const { exigirRol } = require('../middleware/sesion');
const { normalizarTelefono, MAXIMO: MAXIMO_TELEFONO } = require('../telefono');

const router = express.Router();

// Datos de cada sucursal que cargan los duenos (2026-10-05): direccion,
// telefono y el punto de venta que les asigne AFIP, que hace falta para
// facturar. El nombre y si tiene fabrica no se cambian desde aca: son
// estructurales (el sistema decide con eso donde se produce).
router.use(exigirRol('administrador'));

async function sucursales() {
  const { rows } = await consultar(
    'SELECT id_sucursal, nombre, direccion, telefono, punto_venta_afip, tiene_fabrica FROM sucursales WHERE activa ORDER BY id_sucursal'
  );
  return rows;
}

async function mostrar(res, { valores = {}, errores = {}, estado = 200 } = {}) {
  res.status(estado).render('sucursales/index', { lista: await sucursales(), valores, errores, MAXIMO_TELEFONO });
}

router.get('/', async (req, res, siguiente) => {
  try {
    await mostrar(res);
  } catch (error) {
    siguiente(error);
  }
});

router.post('/:id', async (req, res, siguiente) => {
  try {
    const id = Number(req.params.id);
    const sucursal = (await sucursales()).find((s) => s.id_sucursal === id);
    if (!sucursal) return siguiente();

    const datos = {
      direccion: (req.body.direccion || '').trim(),
      telefono: (req.body.telefono || '').trim(),
      punto_venta_afip: (req.body.punto_venta_afip || '').trim(),
    };
    const lista = [];
    if (datos.direccion.length > 255) lista.push('La dirección es muy larga: 255 letras como mucho.');
    const tel = normalizarTelefono(datos.telefono);
    if (tel.error) lista.push(tel.error);
    let punto = null;
    if (datos.punto_venta_afip !== '') {
      if (!/^\d{1,5}$/.test(datos.punto_venta_afip) || Number(datos.punto_venta_afip) < 1) {
        lista.push('El punto de venta de AFIP es un número del 1 al 99999 (el que figura en AFIP, sin ceros adelante).');
      } else {
        punto = Number(datos.punto_venta_afip);
        const { rows } = await consultar(
          'SELECT nombre FROM sucursales WHERE punto_venta_afip = $1 AND id_sucursal <> $2', [punto, id]
        );
        if (rows.length > 0) lista.push('El punto de venta ' + punto + ' ya es de ' + rows[0].nombre + ': cada sucursal factura con el suyo.');
      }
    } else if (sucursal.punto_venta_afip !== null) {
      lista.push('El punto de venta de AFIP no se puede borrar una vez cargado: si cambió, poné el nuevo.');
    }
    if (lista.length > 0) return mostrar(res, { valores: { [id]: datos }, errores: { [id]: lista }, estado: 400 });

    await consultar(
      'UPDATE sucursales SET direccion = $1, telefono = $2, punto_venta_afip = $3 WHERE id_sucursal = $4',
      [datos.direccion || null, tel.telefono, punto, id]
    );
    req.session.aviso = 'Se guardaron los datos de ' + sucursal.nombre + '.';
    res.redirect('/sucursales');
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
