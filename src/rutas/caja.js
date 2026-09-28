'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');

const router = express.Router();

const TURNOS = [
  { valor: 'MANANA', texto: 'Mañana' },
  { valor: 'TARDE', texto: 'Tarde' },
  { valor: 'NOCHE', texto: 'Noche' },
];

// No lleva exigirRol: abrir y cerrar la caja es tarea de mostrador, la hace
// quien atiende. Lo que si se restringe es sobre que sucursal: el empleado
// opera la suya y nada mas.
//
// El dueno no tiene sucursal asignada, porque ve las dos, asi que a el hay que
// preguntarle sobre cual va a trabajar. Cuando exista la configuracion por
// computadora que hablamos, ese selector desaparece y sale de ahi.
async function sucursalesDisponibles(usuario) {
  if (usuario.id_sucursal_asignada) {
    const { rows } = await consultar(
      'SELECT id_sucursal, nombre FROM sucursales WHERE id_sucursal = $1',
      [usuario.id_sucursal_asignada]
    );
    return rows;
  }
  const { rows } = await consultar(
    'SELECT id_sucursal, nombre FROM sucursales WHERE activa ORDER BY nombre'
  );
  return rows;
}

// Lo que el sistema dice que deberia haber en el cajon: lo que se abrio, mas
// lo cobrado en efectivo, menos lo que salio en efectivo. Los cobros con
// tarjeta o por transferencia quedan afuera porque esa plata no esta ahi, y de
// eso se encarga medios_pago.afecta_caja_efectivo.
const SQL_ARQUEO = `
  SELECT c.id_caja,
         c.id_sucursal,
         c.turno,
         c.fecha_apertura,
         c.monto_apertura,
         s.nombre AS sucursal,
         (SELECT coalesce(sum(p.monto), 0)
            FROM pagos_venta p
            JOIN medios_pago m ON m.id_medio_pago = p.id_medio_pago
           WHERE p.id_caja = c.id_caja AND m.afecta_caja_efectivo) AS cobrado_efectivo,
         (SELECT coalesce(sum(e.monto), 0)
            FROM egresos e
            JOIN medios_pago m ON m.id_medio_pago = e.id_medio_pago
           WHERE e.id_caja = c.id_caja AND m.afecta_caja_efectivo) AS egresos_efectivo,
         (SELECT coalesce(sum(p.monto), 0)
            FROM pagos_venta p
            JOIN medios_pago m ON m.id_medio_pago = p.id_medio_pago
           WHERE p.id_caja = c.id_caja AND NOT m.afecta_caja_efectivo) AS cobrado_electronico,
         (SELECT count(*) FROM ventas v
           WHERE v.id_caja = c.id_caja AND v.fecha_anulacion IS NULL)::int AS ventas
    FROM cajas c
    JOIN sucursales s ON s.id_sucursal = c.id_sucursal`;

function esperadoEnCajon(caja) {
  return Number(caja.monto_apertura)
    + Number(caja.cobrado_efectivo)
    - Number(caja.egresos_efectivo);
}

async function cajaAbiertaDe(idSucursal) {
  const { rows } = await consultar(
    SQL_ARQUEO + ' WHERE c.id_sucursal = $1 AND c.fecha_cierre IS NULL',
    [idSucursal]
  );
  return rows[0] || null;
}

// Pantalla principal: si hay una caja abierta en la sucursal, muestra como va
// el turno; si no, el formulario para abrirla.
router.get('/', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = await sucursalesDisponibles(usuario);

    const elegida = Number(req.query.sucursal) || sucursales[0].id_sucursal;
    const abierta = await cajaAbiertaDe(elegida);

    const { rows: ultimas } = await consultar(
      `SELECT c.id_caja, c.turno, c.fecha_apertura, c.fecha_cierre,
              c.monto_cierre_declarado, c.monto_cierre_sistema,
              c.monto_cierre_declarado - c.monto_cierre_sistema AS diferencia,
              s.nombre AS sucursal
         FROM cajas c JOIN sucursales s ON s.id_sucursal = c.id_sucursal
        WHERE c.id_sucursal = $1 AND c.fecha_cierre IS NOT NULL
        ORDER BY c.fecha_cierre DESC
        LIMIT 10`,
      [elegida]
    );

    res.render('caja/estado', {
      sucursales,
      elegida,
      abierta,
      esperado: abierta ? esperadoEnCajon(abierta) : null,
      ultimas,
      TURNOS,
      errores: [],
    });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/abrir', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = await sucursalesDisponibles(usuario);
    const idSucursal = Number(req.body.id_sucursal);
    const turno = req.body.turno;
    const monto = req.body.monto_apertura;

    const errores = [];
    if (!sucursales.some((s) => s.id_sucursal === idSucursal)) {
      errores.push('Esa no es una sucursal sobre la que puedas operar.');
    }
    if (!TURNOS.some((t) => t.valor === turno)) {
      errores.push('Elegí un turno.');
    }
    if (monto === '' || monto === undefined || Number(monto) < 0 || Number.isNaN(Number(monto))) {
      errores.push('Pone con cuanto efectivo arranca la caja. Si arranca vacia, pone cero.');
    }

    if (errores.length > 0) {
      const abierta = await cajaAbiertaDe(idSucursal || sucursales[0].id_sucursal);
      return res.status(400).render('caja/estado', {
        sucursales, elegida: idSucursal || sucursales[0].id_sucursal,
        abierta, esperado: abierta ? esperadoEnCajon(abierta) : null,
        ultimas: [], TURNOS, errores,
      });
    }

    await consultar(
      `INSERT INTO cajas (id_sucursal, turno, id_usuario_apertura, monto_apertura)
       VALUES ($1, $2, $3, $4)`,
      [idSucursal, turno, usuario.id_usuario, monto]
    );

    req.session.aviso = 'Caja abierta. Buen turno.';
    res.redirect('/caja?sucursal=' + idSucursal);
  } catch (error) {
    // La base garantiza una sola caja abierta por sucursal. Si alguien abrio
    // desde otra pantalla mientras esta estaba cargada, el error llega aca y
    // conviene explicarlo en castellano y no mostrar el mensaje de PostgreSQL.
    if (error.code === '23505') {
      req.session.aviso = 'Ya hay una caja abierta en esa sucursal: hay que cerrarla antes de abrir otra.';
      return res.redirect('/caja');
    }
    siguiente(error);
  }
});

// Pantalla de cierre: muestra la cuenta del sistema y pide el conteo real.
router.get('/cerrar', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = await sucursalesDisponibles(usuario);
    const elegida = Number(req.query.sucursal) || sucursales[0].id_sucursal;
    const abierta = await cajaAbiertaDe(elegida);

    if (!abierta) {
      req.session.aviso = 'No hay ninguna caja abierta en esa sucursal.';
      return res.redirect('/caja');
    }

    res.render('caja/cerrar', {
      caja: abierta,
      esperado: esperadoEnCajon(abierta),
      errores: [],
      declarado: '',
      TURNOS,
    });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/cerrar', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = await sucursalesDisponibles(usuario);
    const elegida = Number(req.body.id_sucursal);

    if (!sucursales.some((s) => s.id_sucursal === elegida)) {
      req.session.aviso = 'Esa no es una sucursal sobre la que puedas operar.';
      return res.redirect('/caja');
    }

    const declarado = req.body.monto_cierre_declarado;

    // Todo dentro de una transaccion: el monto que el sistema esperaba se
    // calcula y se guarda en el mismo momento en que se cierra. Si se
    // calculara antes y se guardara despues, una venta cobrada en el medio
    // quedaria fuera de la cuenta y el arqueo mentiria.
    const resultado = await conTransaccion(async (ejecutar) => {
      const { rows } = await ejecutar(
        SQL_ARQUEO + ' WHERE c.id_sucursal = $1 AND c.fecha_cierre IS NULL FOR UPDATE OF c',
        [elegida]
      );
      const caja = rows[0];
      if (!caja) return { sinCaja: true };

      if (declarado === '' || declarado === undefined
          || Number.isNaN(Number(declarado)) || Number(declarado) < 0) {
        return { caja, error: 'Pone cuanto efectivo contaste en el cajon.' };
      }

      const esperado = esperadoEnCajon(caja);
      await ejecutar(
        `UPDATE cajas
            SET fecha_cierre = now(), id_usuario_cierre = $1,
                monto_cierre_declarado = $2, monto_cierre_sistema = $3
          WHERE id_caja = $4`,
        [usuario.id_usuario, declarado, esperado, caja.id_caja]
      );
      return { cerrada: true, diferencia: Number(declarado) - esperado };
    });

    if (resultado.sinCaja) {
      req.session.aviso = 'No hay ninguna caja abierta en esa sucursal.';
      return res.redirect('/caja');
    }

    if (resultado.error) {
      return res.status(400).render('caja/cerrar', {
        caja: resultado.caja,
        esperado: esperadoEnCajon(resultado.caja),
        errores: [resultado.error],
        declarado,
        TURNOS,
      });
    }

    const d = resultado.diferencia;
    req.session.aviso = d === 0
      ? 'Caja cerrada y cuadrada.'
      : 'Caja cerrada. ' + (d > 0 ? 'Sobraron ' : 'Faltaron ') + Math.abs(d).toFixed(2) + '.';
    res.redirect('/caja?sucursal=' + elegida);
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
