'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { sucursalesDisponibles } = require('../sucursales');

const router = express.Router();

const TURNOS = [
  { valor: 'MANANA', texto: 'Mañana' },
  { valor: 'TARDE', texto: 'Tarde' },
  { valor: 'NOCHE', texto: 'Noche' },
];

// No lleva exigirRol: abrir y cerrar la caja es tarea de mostrador, la hace
// quien atiende. Lo que si se restringe es sobre que sucursal (ver
// sucursalesDisponibles).

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

// Un monto de plata valido: positivo y con dos decimales como mucho. Se
// valida el texto, no el numero, porque Number('4000.555') no avisa que
// sobra un decimal.
function montoValido(valor) {
  return typeof valor === 'string' && /^\d+(\.\d{1,2})?$/.test(valor.trim()) && Number(valor) > 0;
}

// Arma todo lo que necesita la pantalla principal. La usan la carga normal y
// los errores de los formularios, para que no se pierda lo que se escribio.
async function mostrarCaja(res, { sucursales, elegida, errores = [], estado = 200, egreso = {} }) {
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
        WHERE e.id_caja = $1
        ORDER BY e.fecha_hora DESC`,
      [abierta.id_caja]
    ));
    ({ rows: empleados } = await consultar(
      `SELECT id_empleado, concat_ws(' ', nombre, apellido) AS nombre
         FROM empleados WHERE activo ORDER BY nombre, apellido`
    ));
    ({ rows: medios } = await consultar(
      'SELECT id_medio_pago, nombre FROM medios_pago WHERE activo ORDER BY id_medio_pago'
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

  res.status(estado).render('caja/estado', {
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
  });
}

// La sucursal pedida, si el usuario puede operarla; si no, la primera suya.
// Sin este control, un empleado que cambie el numero en la direccion veria
// la caja de la otra sucursal.
function sucursalPermitida(valor, sucursales) {
  const id = Number(valor);
  return sucursales.some((s) => s.id_sucursal === id) ? id : sucursales[0].id_sucursal;
}

// Pantalla principal: si hay una caja abierta en la sucursal, muestra como va
// el turno y sus salidas; si no, el formulario para abrirla.
router.get('/', async (req, res, siguiente) => {
  try {
    const sucursales = await sucursalesDisponibles(req.session.usuario);
    await mostrarCaja(res, { sucursales, elegida: sucursalPermitida(req.query.sucursal, sucursales) });
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
      return mostrarCaja(res, {
        sucursales, elegida: sucursalPermitida(idSucursal, sucursales), errores, estado: 400,
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
    const elegida = sucursalPermitida(req.query.sucursal, sucursales);
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

// ---------------------------------------------------------------------------
// Salidas de plata del turno (egresos)
//
// Las carga quien atiende, igual que las ventas. Un egreso pagado por
// transferencia o tarjeta queda registrado pero no toca el cajon: eso lo
// decide medios_pago.afecta_caja_efectivo, igual que en los cobros.

router.post('/egresos', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = await sucursalesDisponibles(usuario);
    const idSucursal = Number(req.body.id_sucursal);
    if (!sucursales.some((s) => s.id_sucursal === idSucursal)) {
      req.session.aviso = 'Esa no es una sucursal sobre la que puedas operar.';
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
    if (!montoValido(egreso.monto)) errores.push('Poné el monto: un número mayor que cero, con dos decimales como mucho.');
    if (esRetiro && !egreso.id_empleado) errores.push('En un retiro, elegí qué empleado se lleva la plata.');
    // En un retiro el empleado ya dice de que se trata; en los demas, sin
    // descripcion nadie sabe despues en que se fue la plata.
    if (!esRetiro && egreso.descripcion === '') errores.push('Escribí en qué se gastó: por ejemplo, «bolsas y servilletas».');
    if (egreso.descripcion.length > TEXTO_MAXIMO) errores.push('La descripción es muy larga: resumila en menos de ' + TEXTO_MAXIMO + ' letras.');
    if (errores.length > 0) {
      return mostrarCaja(res, { sucursales, elegida: idSucursal, errores, estado: 400, egreso });
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
        'SELECT 1 FROM medios_pago WHERE id_medio_pago = $1 AND activo', [egreso.id_medio_pago]
      );
      if (medios.length === 0) return { error: 'Elegí con qué se pagó.' };

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
          esRetiro ? egreso.id_empleado : null, egreso.tipo_egreso, egreso.monto,
          egreso.descripcion || null]
      );
      return {};
    });

    if (resultado.error) {
      return mostrarCaja(res, { sucursales, elegida: idSucursal, errores: [resultado.error], estado: 400, egreso });
    }

    req.session.aviso = 'Salida de $' + Number(egreso.monto).toFixed(2) + ' registrada.';
    res.redirect('/caja?sucursal=' + idSucursal);
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
function motivoParaNoAnularEgreso(egreso, sucursales) {
  if (!egreso || !sucursales.some((s) => s.id_sucursal === egreso.id_sucursal)) {
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
    const sucursales = await sucursalesDisponibles(req.session.usuario);
    const egreso = await egresoParaAnular(consultar, Number(req.params.id), false);
    const impedimento = motivoParaNoAnularEgreso(egreso, sucursales);
    if (impedimento) {
      req.session.aviso = impedimento;
      return res.redirect(egreso ? '/caja?sucursal=' + egreso.id_sucursal : '/caja');
    }
    mostrarAnulacionEgreso(res, egreso);
  } catch (error) {
    siguiente(error);
  }
});

router.post('/egresos/:id/anular', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const sucursales = await sucursalesDisponibles(usuario);
    const motivo = typeof req.body.motivo === 'string' ? req.body.motivo.trim() : '';

    const resultado = await conTransaccion(async (ejecutar) => {
      const egreso = await egresoParaAnular(ejecutar, Number(req.params.id), true);
      const impedimento = motivoParaNoAnularEgreso(egreso, sucursales);
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
      return res.redirect(resultado.egreso ? '/caja?sucursal=' + resultado.egreso.id_sucursal : '/caja');
    }
    if (resultado.error) {
      return mostrarAnulacionEgreso(res, resultado.egreso, { errores: [resultado.error], motivo, estado: 400 });
    }

    // Si la plata salio del cajon y la salida no ocurrio, esa plata tiene que
    // volver al cajon: el arqueo ya la vuelve a esperar ahi.
    req.session.aviso = 'Salida anulada.' + (resultado.egreso.afecta_caja_efectivo
      ? ' Si la plata había salido del cajón, tiene que volver: el arqueo la vuelve a contar.'
      : '');
    res.redirect('/caja?sucursal=' + resultado.egreso.id_sucursal);
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
