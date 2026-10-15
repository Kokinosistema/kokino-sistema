'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { CAMBIO_DE_SUCURSAL } = require('../sucursales');
const { parsearMonto, MONTO_INVALIDO, pesos, aCentavos } = require('../dinero');

const router = express.Router();

// Los turnos salen de la tabla turnos, con su horario (2026-10-07: Manana/Tarde
// de 10 a 18 y Tarde/Noche de 18 a 1). El sugerido al abrir la caja es el que
// corresponde a la hora de ahora; si no cae en ninguno (antes de las 10), el
// primero del dia.
async function leerTurnos() {
  const { rows } = await consultar(
    `SELECT codigo AS valor, nombre AS texto,
            to_char(hora_inicio, 'FMHH24') || ' a ' || to_char(hora_fin, 'FMHH24') || ' h' AS horario,
            CASE WHEN hora_inicio < hora_fin THEN localtime >= hora_inicio AND localtime < hora_fin
                 ELSE localtime >= hora_inicio OR localtime < hora_fin END AS ahora
       FROM turnos ORDER BY orden`
  );
  return rows;
}

function turnoSugerido(turnos) {
  const t = turnos.find((x) => x.ahora) || turnos[0];
  return t ? t.valor : '';
}

// No lleva exigirRol: abrir y cerrar la caja es tarea de mostrador, la hace
// quien atiende. Opera sobre la sucursal de trabajo (ver src/sucursales.js).

// Lo que el sistema dice que deberia haber en el cajon: lo que se abrio, mas
// lo cobrado en efectivo, menos lo que salio en efectivo. Los cobros con
// tarjeta o por transferencia quedan afuera porque esa plata no esta ahi, y de
// eso se encarga medios_pago.afecta_caja_efectivo.
//
// Los pagos de una venta anulada no se borran (la base los congela, y el
// registro de que se cobro tiene que quedar), pero esa plata se le devolvio
// al cliente: si se sumara, el arqueo esperaria en el cajon plata que ya no
// esta y el cierre daria un faltante que no existe.
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
            JOIN ventas v ON v.id_venta = p.id_venta
           WHERE p.id_caja = c.id_caja AND m.afecta_caja_efectivo
             AND v.fecha_anulacion IS NULL) AS cobrado_efectivo,
         (SELECT coalesce(sum(e.monto), 0)
            FROM egresos e
            JOIN medios_pago m ON m.id_medio_pago = e.id_medio_pago
           WHERE e.id_caja = c.id_caja AND m.afecta_caja_efectivo
             AND e.fecha_anulacion IS NULL) AS egresos_efectivo,
         (SELECT coalesce(sum(p.monto), 0)
            FROM pagos_venta p
            JOIN medios_pago m ON m.id_medio_pago = p.id_medio_pago
            JOIN ventas v ON v.id_venta = p.id_venta
           WHERE p.id_caja = c.id_caja AND NOT m.afecta_caja_efectivo
             AND v.fecha_anulacion IS NULL) AS cobrado_electronico,
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

const TIPOS_EGRESO = [
  { valor: 'COMPRA', texto: 'Compra' },
  { valor: 'SERVICIO', texto: 'Servicio' },
  { valor: 'RETIRO_EMPLEADO', texto: 'Retiro de un empleado a cuenta de sueldo' },
  { valor: 'OTRO', texto: 'Otro' },
];

const TEXTO_MAXIMO = 300;

// Lo que no pasa por el cajon es cosa de los duenos: el total cobrado con
// tarjeta o transferencia y las salidas pagadas desde la cuenta del negocio,
// como los pagos a proveedores. El empleado cobra con transferencia, pero no
// ve cuanto entro en el dia; y carga y ve solo las salidas en efectivo, que
// son las que tiene que justificar al contar el cajon.
function esDueno(usuario) {
  return usuario.rol === 'administrador';
}

// Arma todo lo que necesita la pantalla principal. La usan la carga normal y
// los errores de los formularios, para que no se pierda lo que se escribio.
async function mostrarCaja(res, { usuario, sucursales, elegida, errores = [], estado = 200, egreso = {}, turnoElegido = '' }) {
  const verTodo = esDueno(usuario);
  const abierta = await cajaAbiertaDe(elegida);

  let egresos = [];
  let empleados = [];
  let medios = [];
  if (abierta) {
    ({ rows: egresos } = await consultar(
      `SELECT e.id_egreso, e.tipo_egreso, e.monto, e.descripcion, e.fecha_hora,
              e.fecha_anulacion IS NOT NULL AS anulado, e.motivo_anulacion,
              m.nombre AS medio, m.afecta_caja_efectivo,
              concat_ws(' ', emp.nombre, emp.apellido) AS empleado,
              (SELECT ea.nombre
                 FROM usuarios u
                 JOIN empleados ea ON ea.id_empleado = u.id_empleado
                WHERE u.id_usuario = e.id_usuario_anulacion) AS anulo
         FROM egresos e
         JOIN medios_pago m ON m.id_medio_pago = e.id_medio_pago
         LEFT JOIN empleados emp ON emp.id_empleado = e.id_empleado
        WHERE e.id_caja = $1 AND ($2 OR m.afecta_caja_efectivo)
        ORDER BY e.fecha_hora DESC`,
      [abierta.id_caja, verTodo]
    ));
    ({ rows: empleados } = await consultar(
      `SELECT id_empleado, concat_ws(' ', nombre, apellido) AS nombre
         FROM empleados WHERE activo ORDER BY nombre, apellido`
    ));
    ({ rows: medios } = await consultar(
      // Los atados a un canal de venta (solo_canal) no pagan salidas.
      `SELECT id_medio_pago, nombre FROM medios_pago
        WHERE activo AND solo_canal IS NULL AND ($1 OR afecta_caja_efectivo)
        ORDER BY id_medio_pago`,
      [verTodo]
    ));
  }

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

  const TURNOS = await leerTurnos();
  res.status(estado).render('caja/estado', {
    turnoElegido: turnoElegido || turnoSugerido(TURNOS),
    sucursales,
    elegida,
    abierta,
    esperado: abierta ? esperadoEnCajon(abierta) : null,
    ultimas,
    egresos,
    empleados,
    medios,
    egreso,
    TURNOS,
    TIPOS_EGRESO,
    TEXTO_MAXIMO,
    errores,
    verTodo,
  });
}

// Pantalla principal: si hay una caja abierta en la sucursal, muestra como va
// el turno y sus salidas; si no, el formulario para abrirla.
router.get('/', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = [req.sucursal];
    await mostrarCaja(res, { usuario, sucursales, elegida: req.sucursal.id_sucursal });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/abrir', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = [req.sucursal];
    const idSucursal = Number(req.body.id_sucursal);
    const turno = req.body.turno;
    // En formato argentino ($300.000,15); cero vale, si el cajon arranca vacio.
    const monto = parsearMonto(req.body.monto_apertura, { permitirCero: true });

    const errores = [];
    if (!sucursales.some((s) => s.id_sucursal === idSucursal)) {
      errores.push(CAMBIO_DE_SUCURSAL);
    }
    if (!(await leerTurnos()).some((t) => t.valor === turno)) {
      errores.push('Elegí un turno.');
    }
    if (monto === null) {
      errores.push('Poné con cuánto efectivo arranca la caja (si arranca vacía, poné cero): ' + MONTO_INVALIDO + '.');
    }

    if (errores.length > 0) {
      return mostrarCaja(res, {
        usuario, sucursales, elegida: req.sucursal.id_sucursal, errores, estado: 400, turnoElegido: turno,
      });
    }

    await consultar(
      `INSERT INTO cajas (id_sucursal, turno, id_usuario_apertura, monto_apertura)
       VALUES ($1, $2, $3, $4)`,
      [idSucursal, turno, usuario.id_usuario, monto]
    );

    req.session.aviso = 'Caja abierta. Buen turno.';
    res.redirect('/caja');
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
    const sucursales = [req.sucursal];
    const elegida = req.sucursal.id_sucursal;
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
      TURNOS: await leerTurnos(),
      verTodo: esDueno(usuario),
    });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/cerrar', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = [req.sucursal];
    const elegida = Number(req.body.id_sucursal);

    if (!sucursales.some((s) => s.id_sucursal === elegida)) {
      req.session.aviso = CAMBIO_DE_SUCURSAL;
      return res.redirect('/caja');
    }

    // Lo escrito se guarda para volver a mostrarlo si hay un error; lo que
    // va a la base es el monto ya leido del formato argentino.
    const declarado = typeof req.body.monto_cierre_declarado === 'string' ? req.body.monto_cierre_declarado : '';
    const declaradoNormal = parsearMonto(declarado, { permitirCero: true });

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

      if (declaradoNormal === null) {
        return { caja, error: 'Poné cuánto efectivo contaste en el cajón: ' + MONTO_INVALIDO + '.' };
      }

      const esperado = esperadoEnCajon(caja);
      await ejecutar(
        `UPDATE cajas
            SET fecha_cierre = now(), id_usuario_cierre = $1,
                monto_cierre_declarado = $2, monto_cierre_sistema = $3
          WHERE id_caja = $4`,
        [usuario.id_usuario, declaradoNormal, esperado, caja.id_caja]
      );
      // En centavos: con decimales de JavaScript, una caja que cuadra justo
      // podia dar una diferencia de 0.0000001 y decir "sobraron".
      return { cerrada: true, diferencia: (aCentavos(declaradoNormal) - aCentavos(esperado)) / 100 };
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
        TURNOS: await leerTurnos(),
        verTodo: esDueno(usuario),
      });
    }

    const d = resultado.diferencia;
    req.session.aviso = d === 0
      ? 'Caja cerrada y cuadrada.'
      : 'Caja cerrada. ' + (d > 0 ? 'Sobraron ' : 'Faltaron ') + pesos(Math.abs(d)) + '.';
    res.redirect('/caja');
  } catch (error) {
    siguiente(error);
  }
});

// ---------------------------------------------------------------------------
// Salidas de plata del turno (egresos)
//
// Las carga quien atiende, igual que las ventas. Un egreso pagado por
// transferencia o tarjeta queda registrado pero no toca el cajon: eso lo
// decide medios_pago.afecta_caja_efectivo, igual que en los cobros.

router.post('/egresos', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = [req.sucursal];
    const idSucursal = Number(req.body.id_sucursal);
    if (!sucursales.some((s) => s.id_sucursal === idSucursal)) {
      req.session.aviso = CAMBIO_DE_SUCURSAL;
      return res.redirect('/caja');
    }

    const egreso = {
      tipo_egreso: req.body.tipo_egreso,
      monto: typeof req.body.monto === 'string' ? req.body.monto.trim() : '',
      id_medio_pago: Number(req.body.id_medio_pago),
      id_empleado: req.body.id_empleado ? Number(req.body.id_empleado) : null,
      descripcion: typeof req.body.descripcion === 'string' ? req.body.descripcion.trim() : '',
    };
    const esRetiro = egreso.tipo_egreso === 'RETIRO_EMPLEADO';

    const errores = [];
    if (!TIPOS_EGRESO.some((t) => t.valor === egreso.tipo_egreso)) errores.push('Elegí qué tipo de salida es.');
    const montoNormal = parsearMonto(egreso.monto);
    if (montoNormal === null) errores.push('Poné el monto de la salida: ' + MONTO_INVALIDO + '.');
    if (esRetiro && !egreso.id_empleado) errores.push('En un retiro, elegí qué empleado se lleva la plata.');
    // En un retiro el empleado ya dice de que se trata; en los demas, sin
    // descripcion nadie sabe despues en que se fue la plata.
    if (!esRetiro && egreso.descripcion === '') errores.push('Escribí en qué se gastó: por ejemplo, «bolsas y servilletas».');
    if (egreso.descripcion.length > TEXTO_MAXIMO) errores.push('La descripción es muy larga: resumila en menos de ' + TEXTO_MAXIMO + ' letras.');
    if (errores.length > 0) {
      return mostrarCaja(res, { usuario, sucursales, elegida: idSucursal, errores, estado: 400, egreso });
    }

    const resultado = await conTransaccion(async (ejecutar) => {
      // Misma traba que el cierre: una salida y un cierre simultaneos se
      // esperan, y la salida no queda afuera de un arqueo ya hecho.
      const { rows: cajas } = await ejecutar(
        'SELECT id_caja FROM cajas WHERE id_sucursal = $1 AND fecha_cierre IS NULL FOR UPDATE',
        [idSucursal]
      );
      if (cajas.length === 0) return { error: 'No hay una caja abierta en esta sucursal.' };

      const { rows: medios } = await ejecutar(
        'SELECT afecta_caja_efectivo FROM medios_pago WHERE id_medio_pago = $1 AND activo AND solo_canal IS NULL',
        [egreso.id_medio_pago]
      );
      if (medios.length === 0) return { error: 'Elegí con qué se pagó.' };
      if (!medios[0].afecta_caja_efectivo && !esDueno(usuario)) {
        return { error: 'Las salidas por transferencia o tarjeta las registran los dueños.' };
      }

      if (esRetiro) {
        const { rows: empleados } = await ejecutar(
          'SELECT 1 FROM empleados WHERE id_empleado = $1 AND activo', [egreso.id_empleado]
        );
        if (empleados.length === 0) return { error: 'Ese empleado no está activo.' };
      }

      await ejecutar(
        `INSERT INTO egresos (id_caja, id_medio_pago, id_usuario, id_empleado, tipo_egreso, monto, descripcion)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [cajas[0].id_caja, egreso.id_medio_pago, usuario.id_usuario,
          esRetiro ? egreso.id_empleado : null, egreso.tipo_egreso, montoNormal,
          egreso.descripcion || null]
      );
      return {};
    });

    if (resultado.error) {
      return mostrarCaja(res, { usuario, sucursales, elegida: idSucursal, errores: [resultado.error], estado: 400, egreso });
    }

    req.session.aviso = 'Salida de ' + pesos(montoNormal) + ' registrada.';
    res.redirect('/caja');
  } catch (error) {
    siguiente(error);
  }
});

// Trae el egreso con lo necesario para decidir si se puede anular. Con
// bloquear, queda tomado hasta el final de la transaccion.
async function egresoParaAnular(ejecutar, idEgreso, bloquear) {
  if (!Number.isInteger(idEgreso) || idEgreso <= 0) return null;
  const { rows } = await ejecutar(
    `SELECT e.id_egreso, e.tipo_egreso, e.monto, e.descripcion, e.fecha_hora,
            e.fecha_anulacion, c.id_sucursal, c.fecha_cierre,
            m.nombre AS medio, m.afecta_caja_efectivo,
            concat_ws(' ', emp.nombre, emp.apellido) AS empleado
       FROM egresos e
       JOIN cajas c ON c.id_caja = e.id_caja
       JOIN medios_pago m ON m.id_medio_pago = e.id_medio_pago
       LEFT JOIN empleados emp ON emp.id_empleado = e.id_empleado
      WHERE e.id_egreso = $1
      ${bloquear ? 'FOR UPDATE OF e' : ''}`,
    [idEgreso]
  );
  return rows[0] || null;
}

// Las mismas reglas que hace cumplir trg_egresos_congelar, dichas antes y en
// castellano.
function motivoParaNoAnularEgreso(egreso, sucursales, usuario) {
  if (!egreso || !sucursales.some((s) => s.id_sucursal === egreso.id_sucursal)
      || (!egreso.afecta_caja_efectivo && !esDueno(usuario))) {
    return 'No encontramos esa salida entre las de tu sucursal.';
  }
  if (egreso.fecha_anulacion) return 'Esa salida ya estaba anulada.';
  if (egreso.fecha_cierre) return 'La caja de esa salida ya se cerró, así que no se puede anular: su arqueo está hecho.';
  return null;
}

function mostrarAnulacionEgreso(res, egreso, { errores = [], motivo = '', estado = 200 } = {}) {
  res.status(estado).render('caja/anular-egreso', {
    egreso, errores, motivo, TIPOS_EGRESO, TEXTO_MAXIMO,
  });
}

router.get('/egresos/:id/anular', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = [req.sucursal];
    const egreso = await egresoParaAnular(consultar, Number(req.params.id), false);
    const impedimento = motivoParaNoAnularEgreso(egreso, sucursales, usuario);
    if (impedimento) {
      req.session.aviso = impedimento;
      return res.redirect('/caja');
    }
    mostrarAnulacionEgreso(res, egreso);
  } catch (error) {
    siguiente(error);
  }
});

router.post('/egresos/:id/anular', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = [req.sucursal];
    const motivo = typeof req.body.motivo === 'string' ? req.body.motivo.trim() : '';

    const resultado = await conTransaccion(async (ejecutar) => {
      const egreso = await egresoParaAnular(ejecutar, Number(req.params.id), true);
      const impedimento = motivoParaNoAnularEgreso(egreso, sucursales, usuario);
      if (impedimento) return { impedimento, egreso };
      if (motivo === '') return { egreso, error: 'Escribí por qué se anula la salida.' };
      if (motivo.length > TEXTO_MAXIMO) {
        return { egreso, error: 'El motivo es muy largo: resumilo en menos de ' + TEXTO_MAXIMO + ' letras.' };
      }

      await ejecutar(
        `UPDATE egresos
            SET fecha_anulacion = now(), id_usuario_anulacion = $1, motivo_anulacion = $2
          WHERE id_egreso = $3`,
        [usuario.id_usuario, motivo, egreso.id_egreso]
      );
      return { egreso };
    });

    if (resultado.impedimento) {
      req.session.aviso = resultado.impedimento;
      return res.redirect('/caja');
    }
    if (resultado.error) {
      return mostrarAnulacionEgreso(res, resultado.egreso, { errores: [resultado.error], motivo, estado: 400 });
    }

    // Si la plata salio del cajon y la salida no ocurrio, esa plata tiene que
    // volver al cajon: el arqueo ya la vuelve a esperar ahi.
    req.session.aviso = 'Salida anulada.' + (resultado.egreso.afecta_caja_efectivo
      ? ' Si la plata había salido del cajón, tiene que volver: el arqueo la vuelve a contar.'
      : '');
    res.redirect('/caja');
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
