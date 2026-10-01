'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { CAMBIO_DE_SUCURSAL } = require('../sucursales');

const router = express.Router();

// El helado se produce en tachos de 10 litros y cada lote vence a los seis
// meses de elaborado (definido con la usuaria).
const LITROS_POR_TACHO = 10;
const MESES_DE_VENCIMIENTO = 6;
const CANTIDAD_MAXIMA = 999;

// No lleva exigirRol: la produccion la carga el encargado de la sucursal que
// tiene la fabrica, y los duenos. Lo que se restringe es donde: solo se
// produce en la sucursal con fabrica (la base tambien lo exige, con
// trg_produccion_validar). En la otra, la pantalla muestra el stock de
// helado y el boton de cambiar tacho, que es tarea de mostrador.
function puedeProducir(req) {
  return req.sucursal.tiene_fabrica;
}

function hoy() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Lo que se puede producir: los sabores, en tachos de 10 litros, y los
// productos que se fabrican con stock propio (impulsivos y la reposteria
// propia), en su unidad. Van agrupados para que la lista de 70 opciones se
// pueda recorrer.
async function opcionesDeProduccion() {
  const { rows: sabores } = await consultar(
    `SELECT 'sabor:' || s.id_sabor AS valor, s.nombre || ' (' || lower(s.linea) || ')' AS nombre,
            c.nombre AS grupo
       FROM sabores s JOIN categorias c ON c.id_categoria = s.id_categoria
      ORDER BY c.nombre, s.nombre, s.linea`
  );
  const { rows: productos } = await consultar(
    `SELECT 'producto:' || p.id_producto AS valor, p.nombre, c.nombre AS grupo, u.nombre AS unidad
       FROM productos p
       JOIN categorias c ON c.id_categoria = p.id_categoria
       JOIN unidades_medida u ON u.id_unidad = p.id_unidad_medida
      WHERE p.tipo_origen = 'PRODUCIDO_DIRECTO' AND p.lleva_stock_propio AND p.activo
      ORDER BY c.nombre, p.nombre`
  );
  const grupos = [];
  const agregar = (grupo, opcion) => {
    let g = grupos.find((x) => x.nombre === grupo);
    if (!g) { g = { nombre: grupo, opciones: [] }; grupos.push(g); }
    g.opciones.push(opcion);
  };
  for (const s of sabores) agregar('Helado — ' + s.grupo + ' (tachos de 10 L)', { valor: s.valor, nombre: s.nombre, unidad: 'tachos de 10 L' });
  for (const p of productos) agregar(p.grupo + ' (' + p.unidad.toLowerCase() + ')', { valor: p.valor, nombre: p.nombre, unidad: p.unidad.toLowerCase() });
  return grupos;
}

async function mostrar(req, res, { errores = [], elegido = {}, estado = 200 } = {}) {
  const idSucursal = req.sucursal.id_sucursal;

  // Stock de helado: los tachos llenos y el que esta en el pozo, por sabor.
  const { rows: stock } = await consultar(
    `SELECT s.id_sabor, s.nombre || ' (' || lower(s.linea) || ')' AS sabor,
            count(*) FILTER (WHERE t.estado = 'EN_POZO')::int AS en_pozo,
            count(*) FILTER (WHERE t.estado = 'LLENO')::int AS llenos,
            sum(t.capacidad_litros) AS litros,
            min(l.fecha_vencimiento) FILTER (WHERE t.estado = 'LLENO') AS proximo_vencimiento
       FROM tachos t
       JOIN lotes l ON l.id_lote = t.id_lote
       JOIN sabores s ON s.id_sabor = l.id_sabor
      WHERE t.id_sucursal = $1 AND t.estado IN ('LLENO', 'EN_POZO')
      GROUP BY s.id_sabor, s.nombre, s.linea
      ORDER BY s.nombre, s.linea`,
    [idSucursal]
  );

  let historial = [];
  let opciones = [];
  if (puedeProducir(req)) {
    ({ rows: historial } = await consultar(
      `SELECT p.fecha_produccion, p.cantidad_real, p.id_receta IS NOT NULL AS con_receta,
              coalesce(s.nombre || ' (' || lower(s.linea) || ')', pr.nombre) AS que,
              p.id_sabor IS NOT NULL AS es_helado, u.abreviatura AS unidad,
              e.nombre AS quien
         FROM produccion p
         LEFT JOIN sabores s ON s.id_sabor = p.id_sabor
         LEFT JOIN productos pr ON pr.id_producto = p.id_producto
         LEFT JOIN unidades_medida u ON u.id_unidad = pr.id_unidad_medida
         JOIN usuarios us ON us.id_usuario = p.id_usuario_responsable
         JOIN empleados e ON e.id_empleado = us.id_empleado
        WHERE p.id_sucursal = $1
        ORDER BY p.fecha_produccion DESC, p.id_produccion DESC
        LIMIT 20`,
      [idSucursal]
    ));
    opciones = await opcionesDeProduccion();
  }

  res.status(estado).render('fabricacion/index', {
    puedeProducir: puedeProducir(req), stock, historial, opciones, errores,
    elegido: Object.assign({ fecha: hoy(), que: '', cantidad: '' }, elegido),
    hoy: hoy(), LITROS_POR_TACHO, CANTIDAD_MAXIMA,
  });
}

router.get('/', async (req, res, siguiente) => {
  try {
    await mostrar(req, res);
  } catch (error) {
    siguiente(error);
  }
});

router.post('/produccion', async (req, res, siguiente) => {
  try {
    const { usuario } = req.session;
    const elegido = {
      fecha: typeof req.body.fecha === 'string' ? req.body.fecha : '',
      que: typeof req.body.que === 'string' ? req.body.que : '',
      cantidad: typeof req.body.cantidad === 'string' ? req.body.cantidad.trim() : '',
    };
    if (Number(req.body.id_sucursal) !== req.sucursal.id_sucursal) {
      req.session.aviso = CAMBIO_DE_SUCURSAL;
      return res.redirect('/fabricacion');
    }
    if (!puedeProducir(req)) {
      req.session.aviso = 'La producción se registra en la sucursal donde está la fábrica.';
      return res.redirect('/fabricacion');
    }

    const errores = [];
    const tipo = /^(sabor|producto):(\d+)$/.exec(elegido.que);
    if (!tipo) errores.push('Elegí qué se produjo.');
    if (!/^\d{1,3}$/.test(elegido.cantidad) || Number(elegido.cantidad) < 1) {
      errores.push('Poné cuánto se produjo: un número entero, de 1 a ' + CANTIDAD_MAXIMA + '.');
    }
    // Se puede cargar una produccion de un dia anterior, pero no del futuro.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(elegido.fecha) || Number.isNaN(Date.parse(elegido.fecha))) {
      errores.push('Elegí el día en que se produjo.');
    } else if (elegido.fecha > hoy()) {
      errores.push('La producción no puede tener una fecha que todavía no llegó.');
    }
    if (errores.length > 0) return mostrar(req, res, { errores, elegido, estado: 400 });

    const cantidad = Number(elegido.cantidad);
    const esHelado = tipo[1] === 'sabor';
    const id = Number(tipo[2]);
    // Si es de hoy, con la hora de ahora; si es de otro dia, al mediodia de ese dia.
    const fechaProduccion = elegido.fecha === hoy() ? new Date() : new Date(elegido.fecha + 'T12:00:00');

    let resultado;
    try {
      resultado = await conTransaccion(async (ejecutar) => {
        const { rows: [cosa] } = await ejecutar(
          esHelado
            ? "SELECT nombre || ' (' || lower(linea) || ')' AS nombre FROM sabores WHERE id_sabor = $1"
            : "SELECT p.nombre, lower(u.nombre) AS unidad FROM productos p JOIN unidades_medida u ON u.id_unidad = p.id_unidad_medida WHERE p.id_producto = $1",
          [id]
        );
        if (!cosa) return { error: 'Elegí qué se produjo.' };

        // La receta vigente, si tiene: con ella la base descuenta los
        // insumos. Sin receta se registra igual, como se decidio.
        const { rows: [receta] } = await ejecutar(
          `SELECT id_receta FROM recetas
            WHERE ${esHelado ? 'id_sabor_resultado' : 'id_producto_resultado'} = $1
              AND fecha_vigencia_hasta IS NULL`,
          [id]
        );

        // El helado se cuenta en litros (tachos de 10 L); un producto, en su unidad.
        const producido = esHelado ? cantidad * LITROS_POR_TACHO : cantidad;
        const { rows: [produccion] } = await ejecutar(
          `INSERT INTO produccion
             (id_sabor, id_producto, id_receta, id_sucursal, id_usuario_responsable,
              fecha_produccion, cantidad_teorica, cantidad_real)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
           RETURNING id_produccion`,
          [esHelado ? id : null, esHelado ? null : id, receta ? receta.id_receta : null,
            req.sucursal.id_sucursal, usuario.id_usuario, fechaProduccion, producido]
        );

        if (esHelado) {
          // Un lote por produccion, que vence a los seis meses, y un tacho
          // lleno por cada uno producido, con su codigo para distinguirlos.
          const codigoLote = 'L' + elegido.fecha.replace(/-/g, '') + '-' + produccion.id_produccion;
          const { rows: [lote] } = await ejecutar(
            `INSERT INTO lotes (id_produccion, codigo_lote, fecha_elaboracion, fecha_vencimiento)
             VALUES ($1, $2, $3::date, $3::date + make_interval(months => $4))
             RETURNING id_lote`,
            [produccion.id_produccion, codigoLote, elegido.fecha, MESES_DE_VENCIMIENTO]
          );
          for (let i = 1; i <= cantidad; i += 1) {
            await ejecutar(
              `INSERT INTO tachos (id_lote, id_sucursal, codigo_barras, capacidad_litros)
               VALUES ($1, $2, $3, $4)`,
              [lote.id_lote, req.sucursal.id_sucursal, codigoLote + '-' + String(i).padStart(2, '0'), LITROS_POR_TACHO]
            );
          }
        }
        return { cosa, conReceta: Boolean(receta) };
      });
    } catch (error) {
      // Las reglas de la base que tienen explicacion para quien carga, como
      // una receta que rinde en una unidad que no convierte: su mensaje esta
      // escrito para leerse.
      if (error.code === 'P0001') return mostrar(req, res, { errores: [error.message], elegido, estado: 400 });
      throw error;
    }
    if (resultado.error) return mostrar(req, res, { errores: [resultado.error], elegido, estado: 400 });

    const cuanto = esHelado
      ? cantidad + (cantidad === 1 ? ' tacho' : ' tachos') + ' de ' + resultado.cosa.nombre
      : cantidad + ' ' + (cantidad === 1 ? resultado.cosa.unidad : resultado.cosa.unidad + (resultado.cosa.unidad.endsWith('d') ? 'es' : 's')) + ' de ' + resultado.cosa.nombre;
    req.session.aviso = (cantidad === 1 ? 'Se registró ' : 'Se registraron ') + cuanto + '.'
      + (resultado.conReceta ? '' : ' Todavía no tiene receta, así que no se descontaron insumos.');
    res.redirect('/fabricacion');
  } catch (error) {
    siguiente(error);
  }
});

function quedan(n) {
  return n === 1 ? 'Queda 1 lleno.' : 'Quedan ' + n + ' llenos.';
}

// Cambiar el tacho de un sabor: el del pozo se termino (queda vacio) y se
// abre el lleno mas viejo, el primero en vencer. Es la baja normal del stock
// de helado a peso, que no se descuenta en cada venta.
router.post('/cambiar-tacho', async (req, res, siguiente) => {
  try {
    if (Number(req.body.id_sucursal) !== req.sucursal.id_sucursal) {
      req.session.aviso = CAMBIO_DE_SUCURSAL;
      return res.redirect('/fabricacion');
    }
    const idSabor = Number(req.body.id_sabor);
    if (!Number.isInteger(idSabor)) return res.redirect('/fabricacion');

    const resultado = await conTransaccion(async (ejecutar) => {
      // Tomados hasta el final: dos personas cambiando el mismo sabor a la
      // vez no pueden vaciar dos tachos por un solo cambio.
      const { rows: tachos } = await ejecutar(
        `SELECT t.id_tacho, t.estado
           FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote
          WHERE t.id_sucursal = $1 AND l.id_sabor = $2 AND t.estado IN ('LLENO', 'EN_POZO')
          ORDER BY l.fecha_vencimiento, t.id_tacho
          FOR UPDATE OF t`,
        [req.sucursal.id_sucursal, idSabor]
      );
      const enPozo = tachos.find((t) => t.estado === 'EN_POZO');
      const siguienteLleno = tachos.find((t) => t.estado === 'LLENO');
      if (!enPozo && !siguienteLleno) return { sinTachos: true };

      if (enPozo) await ejecutar("UPDATE tachos SET estado = 'VACIO' WHERE id_tacho = $1", [enPozo.id_tacho]);
      if (siguienteLleno) await ejecutar("UPDATE tachos SET estado = 'EN_POZO' WHERE id_tacho = $1", [siguienteLleno.id_tacho]);

      const { rows: [sabor] } = await ejecutar(
        "SELECT nombre || ' (' || lower(linea) || ')' AS nombre FROM sabores WHERE id_sabor = $1", [idSabor]
      );
      const quedan = tachos.filter((t) => t.estado === 'LLENO').length - (siguienteLleno ? 1 : 0);
      return { sabor: sabor.nombre, habiaEnPozo: Boolean(enPozo), abrio: Boolean(siguienteLleno), quedan };
    });

    if (resultado.sinTachos) {
      req.session.aviso = 'No hay tachos de ese sabor en ' + req.sucursal.nombre + '.';
    } else if (!resultado.habiaEnPozo) {
      req.session.aviso = 'Se abrió el primer tacho de ' + resultado.sabor + '. ' + quedan(resultado.quedan);
    } else if (resultado.abrio) {
      req.session.aviso = 'Se terminó un tacho de ' + resultado.sabor + ' y se abrió el siguiente. ' + quedan(resultado.quedan);
    } else {
      req.session.aviso = 'Se terminó el tacho de ' + resultado.sabor + '. No quedan tachos llenos de este sabor en ' + req.sucursal.nombre + '.';
    }
    res.redirect('/fabricacion');
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
