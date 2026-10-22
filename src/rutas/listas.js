'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { exigirRol } = require('../middleware/sesion');
const { parsearMonto, MONTO_INVALIDO, aCentavos } = require('../dinero');

const router = express.Router();

// Listas de precios mayoristas (2026-10-22): los duenos cambian los precios
// de cada sabor, el del envase, y crean listas para clientes fijos nuevas.
// Un precio nuevo cierra el anterior y rige desde hoy; borrar un precio deja
// al sabor sin precio en esa lista. Las listas se renombran pero no se
// borran: tienen historial. Se monta en /clientes/listas, antes que el
// router de mayoristas, para que /clientes/:id no tome estas direcciones.
router.use(exigirRol('administrador'));

const QUIEN = `coalesce((SELECT concat_ws(' ', e.nombre, e.apellido) FROM usuarios u
  JOIN empleados e ON e.id_empleado = u.id_empleado WHERE u.id_usuario = p.id_usuario), 'Carga inicial')`;

function lineasDe(l) {
  if (l.incluye_familiar && l.incluye_artesanal) return 'Familiar y artesanal';
  return l.incluye_familiar ? 'Solo familiar' : 'Solo artesanal';
}

// Cuantos clientes activos usan cada lista: los de la general son los que
// no tienen lista propia.
async function traerListas() {
  const { rows } = await consultar(
    `SELECT l.*,
            (SELECT count(*) FROM clientes c
              WHERE c.tipo_cliente = 'MAYORISTA' AND c.activo
                AND (c.id_lista_precios = l.id_lista_precios OR (l.es_general AND c.id_lista_precios IS NULL)))::int AS clientes,
            (SELECT count(*) FROM precios_lista_mayorista p
              WHERE p.id_lista_precios = l.id_lista_precios AND p.fecha_vigencia_hasta IS NULL)::int AS precios
       FROM listas_precios_mayoristas l
      ORDER BY l.es_general DESC, l.nombre`
  );
  return rows.map((l) => ({ ...l, lineas: lineasDe(l) }));
}

async function envaseVigente() {
  const { rows: [e] } = await consultar(
    'SELECT id_precio_envase, precio, fecha_vigencia_desde AS desde FROM precios_envase_mayorista WHERE fecha_vigencia_hasta IS NULL'
  );
  return e ? { ...e, precio: Number(e.precio) } : null;
}

async function nombreOcupado(nombre, salvoId) {
  const { rows } = await consultar(
    'SELECT 1 FROM listas_precios_mayoristas WHERE lower(nombre) = lower($1) AND id_lista_precios IS DISTINCT FROM $2::int',
    [nombre, salvoId]
  );
  return rows.length > 0;
}

// Lo que se escribe en el formulario de una lista: nombre y lineas.
function leerLista(cuerpo) {
  return {
    nombre: (typeof cuerpo.nombre === 'string' ? cuerpo.nombre : '').trim().slice(0, 100),
    incluye_familiar: cuerpo.incluye_familiar === '1',
    incluye_artesanal: cuerpo.incluye_artesanal === '1',
  };
}

async function erroresDeLista(datos, salvoId) {
  const errores = [];
  if (datos.nombre.length < 2) errores.push('Ponele un nombre a la lista (por ejemplo, el del cliente: Lista Terminal).');
  else if (await nombreOcupado(datos.nombre, salvoId)) errores.push('Ya hay una lista que se llama ' + datos.nombre + '.');
  if (!datos.incluye_familiar && !datos.incluye_artesanal) errores.push('Elegí al menos una línea.');
  return errores;
}

// ---------------------------------------------------------------------------
// Todas las listas, el envase y crear una nueva

async function mostrarListas(res, { errores = [], nueva = null, valorEnvase = null, estado = 200 } = {}) {
  const listas = await traerListas();
  res.status(estado).render('listas/index', {
    listas, errores,
    envase: await envaseVigente(),
    valorEnvase,
    nueva: nueva || { nombre: '', incluye_familiar: true, incluye_artesanal: false, copiar_de: '' },
  });
}

router.get('/', async (req, res, siguiente) => {
  try {
    await mostrarListas(res);
  } catch (error) {
    siguiente(error);
  }
});

// Una lista nueva puede arrancar con los precios de otra, de las lineas que
// incluye, para no cargarlos todos de cero.
router.post('/', async (req, res, siguiente) => {
  try {
    const datos = leerLista(req.body);
    const copiarDe = typeof req.body.copiar_de === 'string' ? req.body.copiar_de : '';
    const errores = await erroresDeLista(datos, null);
    const listas = await traerListas();
    const origen = copiarDe === '' ? null : listas.find((l) => l.id_lista_precios === Number(copiarDe));
    if (copiarDe !== '' && !origen) errores.push('Elegí de qué lista copiar los precios.');
    if (errores.length > 0) return mostrarListas(res, { errores, nueva: { ...datos, copiar_de: copiarDe }, estado: 400 });

    const id = await conTransaccion(async (ejecutar) => {
      const { rows: [l] } = await ejecutar(
        `INSERT INTO listas_precios_mayoristas (nombre, incluye_familiar, incluye_artesanal)
         VALUES ($1, $2, $3) RETURNING id_lista_precios`,
        [datos.nombre, datos.incluye_familiar, datos.incluye_artesanal]
      );
      if (origen) {
        await ejecutar(
          `INSERT INTO precios_lista_mayorista (id_lista_precios, id_sabor, precio, id_usuario)
           SELECT $1, p.id_sabor, p.precio, $2
             FROM precios_lista_mayorista p JOIN sabores s ON s.id_sabor = p.id_sabor
            WHERE p.id_lista_precios = $3 AND p.fecha_vigencia_hasta IS NULL
              AND ((s.linea = 'FAMILIAR' AND $4) OR (s.linea = 'ARTESANAL' AND $5))`,
          [l.id_lista_precios, req.session.usuario.id_usuario, origen.id_lista_precios, datos.incluye_familiar, datos.incluye_artesanal]
        );
      }
      return l.id_lista_precios;
    });
    req.session.aviso = 'Se creó la ' + datos.nombre + (origen ? ', con los precios de la ' + origen.nombre + '. Cambiá los que sean distintos.' : '. Cargale los precios.');
    res.redirect('/clientes/listas/' + id);
  } catch (error) {
    siguiente(error);
  }
});

// El envase no se puede dejar sin precio: sin el, no se puede cotizar a
// quien compra los envases.
router.post('/envase', async (req, res, siguiente) => {
  try {
    const texto = typeof req.body.precio === 'string' ? req.body.precio.trim() : '';
    const precio = parsearMonto(texto);
    if (precio === null) {
      return mostrarListas(res, { errores: ['El precio del envase: ' + MONTO_INVALIDO + '.'], valorEnvase: texto, estado: 400 });
    }
    const actual = await envaseVigente();
    if (actual && aCentavos(actual.precio) === aCentavos(precio)) {
      req.session.aviso = 'El precio del envase no cambió.';
      return res.redirect('/clientes/listas');
    }
    await conTransaccion(async (ejecutar) => {
      await ejecutar('UPDATE precios_envase_mayorista SET fecha_vigencia_hasta = current_date WHERE fecha_vigencia_hasta IS NULL');
      await ejecutar('INSERT INTO precios_envase_mayorista (precio, id_usuario) VALUES ($1, $2)', [precio, req.session.usuario.id_usuario]);
    });
    req.session.aviso = 'Se guardó el precio nuevo del envase. Rige desde hoy.';
    res.redirect('/clientes/listas');
  } catch (error) {
    siguiente(error);
  }
});

// ---------------------------------------------------------------------------
// Una lista: su nombre y lineas, y el precio de cada sabor

async function traerLista(id) {
  if (!Number.isInteger(id)) return null;
  const { rows: [l] } = await consultar('SELECT * FROM listas_precios_mayoristas WHERE id_lista_precios = $1', [id]);
  return l ? { ...l, lineas: lineasDe(l) } : null;
}

// Los sabores activos de las lineas que incluye la lista, con su precio
// vigente (o null). Primero los familiares.
async function saboresDe(lista) {
  const { rows } = await consultar(
    `SELECT s.id_sabor, s.nombre, s.linea, p.id_precio_lista, p.precio, p.fecha_vigencia_desde AS desde
       FROM sabores s
       LEFT JOIN precios_lista_mayorista p
              ON p.id_sabor = s.id_sabor AND p.id_lista_precios = $1 AND p.fecha_vigencia_hasta IS NULL
      WHERE s.activo AND ((s.linea = 'FAMILIAR' AND $2) OR (s.linea = 'ARTESANAL' AND $3))
      ORDER BY s.linea DESC, s.nombre`,
    [lista.id_lista_precios, lista.incluye_familiar, lista.incluye_artesanal]
  );
  return rows.map((s) => ({ ...s, precio: s.precio === null ? null : Number(s.precio) }));
}

async function mostrarLista(res, lista, { errores = [], valores = null, datos = null, estado = 200 } = {}) {
  const { rows: historial } = await consultar(
    `SELECT s.nombre || ' (' || lower(s.linea) || ')' AS sabor, p.precio,
            p.fecha_vigencia_desde AS desde, p.fecha_vigencia_hasta AS hasta, ${QUIEN} AS quien
       FROM precios_lista_mayorista p JOIN sabores s ON s.id_sabor = p.id_sabor
      WHERE p.id_lista_precios = $1
      ORDER BY p.id_precio_lista DESC
      LIMIT 30`,
    [lista.id_lista_precios]
  );
  res.status(estado).render('listas/editar', {
    lista, errores, valores, historial,
    datos: datos || { nombre: lista.nombre, incluye_familiar: lista.incluye_familiar, incluye_artesanal: lista.incluye_artesanal },
    sabores: await saboresDe(lista),
  });
}

router.get('/:id', async (req, res, siguiente) => {
  try {
    const lista = await traerLista(Number(req.params.id));
    if (!lista) return siguiente();
    await mostrarLista(res, lista);
  } catch (error) {
    siguiente(error);
  }
});

// Nombre y lineas. La general siempre tiene las dos. A una lista no se le
// saca una linea mientras tenga precios de esa linea (la base tampoco lo
// deja): primero se borran.
router.post('/:id', async (req, res, siguiente) => {
  try {
    const lista = await traerLista(Number(req.params.id));
    if (!lista) return siguiente();
    const datos = leerLista(req.body);
    if (lista.es_general) { datos.incluye_familiar = true; datos.incluye_artesanal = true; }
    const errores = await erroresDeLista(datos, lista.id_lista_precios);
    for (const [linea, sigue, texto] of [['FAMILIAR', datos.incluye_familiar, 'familiares'], ['ARTESANAL', datos.incluye_artesanal, 'artesanales']]) {
      if (sigue) continue;
      const { rows: [c] } = await consultar(
        `SELECT count(*)::int AS n FROM precios_lista_mayorista p JOIN sabores s ON s.id_sabor = p.id_sabor
          WHERE p.id_lista_precios = $1 AND p.fecha_vigencia_hasta IS NULL AND s.linea = $2`,
        [lista.id_lista_precios, linea]
      );
      if (c.n > 0) errores.push('La ' + lista.nombre + ' tiene ' + c.n + ' precios de sabores ' + texto + ': borralos antes de sacarle esa línea.');
    }
    if (errores.length > 0) return mostrarLista(res, lista, { errores, datos, estado: 400 });
    await consultar(
      'UPDATE listas_precios_mayoristas SET nombre = $1, incluye_familiar = $2, incluye_artesanal = $3 WHERE id_lista_precios = $4',
      [datos.nombre, datos.incluye_familiar, datos.incluye_artesanal, lista.id_lista_precios]
    );
    req.session.aviso = 'Se guardaron los cambios de la ' + datos.nombre + '.';
    res.redirect('/clientes/listas/' + lista.id_lista_precios);
  } catch (error) {
    siguiente(error);
  }
});

// Los precios: solo se graban los que cambiaron. Uno vacio que tenia precio
// lo cierra, y el sabor queda sin precio en la lista.
router.post('/:id/precios', async (req, res, siguiente) => {
  try {
    const lista = await traerLista(Number(req.params.id));
    if (!lista) return siguiente();
    const sabores = await saboresDe(lista);
    const valores = {};
    const errores = [];
    const cambios = [];
    for (const s of sabores) {
      // Un campo que no vino no cambia nada; solo uno que vino vacio borra.
      if (typeof req.body['precio_' + s.id_sabor] !== 'string') continue;
      const texto = req.body['precio_' + s.id_sabor].trim();
      valores[s.id_sabor] = texto;
      if (texto === '') {
        if (s.precio !== null) cambios.push({ sabor: s, precio: null });
        continue;
      }
      const precio = parsearMonto(texto);
      if (precio === null) { errores.push('El precio de ' + s.nombre + ' (' + s.linea.toLowerCase() + '): ' + MONTO_INVALIDO + '.'); continue; }
      if (s.precio === null || aCentavos(s.precio) !== aCentavos(precio)) cambios.push({ sabor: s, precio });
    }
    if (errores.length > 0) return mostrarLista(res, lista, { errores, valores, estado: 400 });
    if (cambios.length === 0) {
      req.session.aviso = 'No había ningún precio para cambiar.';
      return res.redirect('/clientes/listas/' + lista.id_lista_precios);
    }
    await conTransaccion(async (ejecutar) => {
      for (const c of cambios) {
        if (c.sabor.id_precio_lista) {
          await ejecutar('UPDATE precios_lista_mayorista SET fecha_vigencia_hasta = current_date WHERE id_precio_lista = $1', [c.sabor.id_precio_lista]);
        }
        if (c.precio !== null) {
          await ejecutar(
            'INSERT INTO precios_lista_mayorista (id_lista_precios, id_sabor, precio, id_usuario) VALUES ($1, $2, $3, $4)',
            [lista.id_lista_precios, c.sabor.id_sabor, c.precio, req.session.usuario.id_usuario]
          );
        }
      }
    });
    const sacados = cambios.filter((c) => c.precio === null).length;
    req.session.aviso = (cambios.length === 1 ? 'Se guardó 1 cambio en la ' + lista.nombre + '. Rige' : 'Se guardaron ' + cambios.length + ' cambios en la ' + lista.nombre + '. Rigen') + ' desde hoy.'
      + (sacados > 0 ? ' ' + (sacados === 1 ? 'Un sabor quedó' : sacados + ' sabores quedaron') + ' sin precio.' : '');
    res.redirect('/clientes/listas/' + lista.id_lista_precios);
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
module.exports.traerListas = traerListas;
