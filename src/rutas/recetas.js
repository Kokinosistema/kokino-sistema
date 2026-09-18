'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');

const router = express.Router();

const FASES = [
  { valor: 'TINA', texto: 'Tina (va en la mezcla)' },
  { valor: 'TACHO', texto: 'Tacho (se agrega al fraccionar)' },
];

// El dueno escribe las formulas; el empleado que hace la tanda en la fabrica
// puede abrirlas para seguirlas mientras produce, pero no cambiarlas.
function puedeEditar(req) {
  return req.session.usuario.rol === 'administrador';
}

function soloAdministrador(res) {
  res.status(403).render('error', {
    titulo: 'No tenes permiso',
    mensaje: 'Las formulas las escriben los duenos. Vos podes consultarlas.',
  });
}

function exigirEdicion(req, res, siguiente) {
  if (!puedeEditar(req)) return soloAdministrador(res);
  siguiente();
}

// Una receta produce un sabor de helado o un producto elaborado, nunca las dos
// cosas: lo dice el constraint de la tabla.
//
// Del lado de los productos entran los PRODUCIDO_DIRECTO que ademas llevan
// stock propio. Las dos condiciones hacen falta y filtran cosas distintas:
//
//   - tipo_origen deja afuera a los PRODUCIDO_DESDE_SABOR, porque lo suyo no es
//     una formula sino de que sabor se llena el envase, y eso ya vive en
//     producto_sabores.
//   - lleva_stock_propio deja afuera a lo que se arma recien al vender: un
//     cafe, un brownie con helado, un bano de chocolate. Una receta describe
//     una tanda que rinde una cantidad y queda guardada; eso no se produce, se
//     prepara en el momento. Lo que consumen al venderse va en
//     producto_insumos, que es otra tabla y otra pregunta.
//
// Sin el segundo filtro el dueno veria "cargar formula" al lado de Cafe chico
// y tendria que adivinar cuanto rinde una tanda de cafe.
const SQL_CANDIDATOS = `
  SELECT 'SABOR'        AS clase,
         s.id_sabor     AS id,
         s.nombre       AS nombre,
         c.nombre       AS grupo
    FROM sabores s
    JOIN categorias c ON c.id_categoria = s.id_categoria
  UNION ALL
  SELECT 'PRODUCTO', p.id_producto, p.nombre, c.nombre
    FROM productos p
    JOIN categorias c ON c.id_categoria = p.id_categoria
   WHERE p.tipo_origen = 'PRODUCIDO_DIRECTO'
     AND p.lleva_stock_propio
     AND p.activo
`;

// La lista es tambien el avance de la carga: con 54 sabores por delante, lo
// que mas le sirve al dueno es ver de un vistazo que le falta.
router.get('/', async (req, res, siguiente) => {
  try {
    const { rows } = await consultar(
      `WITH candidatos AS (${SQL_CANDIDATOS})
       SELECT c.clase, c.id, c.nombre, c.grupo,
              r.id_receta, r.version, r.cantidad_rendimiento,
              u.abreviatura AS unidad_rendimiento,
              (SELECT count(*)::int FROM receta_detalle d WHERE d.id_receta = r.id_receta) AS ingredientes
         FROM candidatos c
         LEFT JOIN recetas r
           ON r.fecha_vigencia_hasta IS NULL
          AND ((c.clase = 'SABOR'    AND r.id_sabor_resultado = c.id)
            OR (c.clase = 'PRODUCTO' AND r.id_producto_resultado = c.id))
         LEFT JOIN unidades_medida u ON u.id_unidad = r.id_unidad_rendimiento
        ORDER BY (r.id_receta IS NOT NULL), c.clase DESC, c.grupo, c.nombre`
    );

    const conReceta = rows.filter((f) => f.id_receta !== null).length;
    res.render('recetas/lista', {
      filas: rows,
      conReceta,
      total: rows.length,
      puedeEditar: puedeEditar(req),
    });
  } catch (error) {
    siguiente(error);
  }
});

async function traerCandidato(clase, id) {
  const { rows } = await consultar(
    `WITH candidatos AS (${SQL_CANDIDATOS})
     SELECT * FROM candidatos WHERE clase = $1 AND id = $2`,
    [clase, id]
  );
  return rows[0];
}

// Solo se ofrecen unidades de la misma magnitud que la unidad de compra del
// insumo. La base dice que solo se convierten entre si las unidades de la
// misma familia: pasar de volumen a peso en el helado necesitaria la densidad
// del sabor, que no es un dato de la unidad. Sin esta restriccion se podria
// cargar "2 botellas de azucar", que guarda bien y despues no se puede costear.
async function traerInsumos() {
  const { rows } = await consultar(
    `SELECT i.id_insumo, i.nombre, u.magnitud, u.abreviatura AS unidad_compra
       FROM insumos i
       JOIN unidades_medida u ON u.id_unidad = i.id_unidad_medida
      WHERE i.activo
      ORDER BY i.nombre`
  );
  return rows;
}

async function traerUnidades() {
  const { rows } = await consultar(
    'SELECT id_unidad, abreviatura, nombre, magnitud FROM unidades_medida ORDER BY magnitud, factor_a_base'
  );
  return rows;
}

// Una receta se puede editar encima mientras ninguna produccion la haya usado:
// la razon para versionar es no hacer mentir a las producciones ya
// registradas, y si no hay ninguna, no hay nada que pueda mentir. Apenas se
// produce una tanda con ella queda congelada, y guardar abre la version
// siguiente.
async function yaSeUso(idReceta, ejecutar) {
  const correr = ejecutar || consultar;
  const { rows } = await correr(
    'SELECT count(*)::int AS n FROM produccion WHERE id_receta = $1',
    [idReceta]
  );
  return rows[0].n > 0;
}

async function traerReceta(idReceta) {
  const { rows } = await consultar(
    `SELECT r.*, u.abreviatura AS unidad_rendimiento,
            coalesce(s.nombre, p.nombre) AS nombre_resultado,
            CASE WHEN r.id_sabor_resultado IS NOT NULL THEN 'SABOR' ELSE 'PRODUCTO' END AS clase
       FROM recetas r
       JOIN unidades_medida u ON u.id_unidad = r.id_unidad_rendimiento
       LEFT JOIN sabores s   ON s.id_sabor = r.id_sabor_resultado
       LEFT JOIN productos p ON p.id_producto = r.id_producto_resultado
      WHERE r.id_receta = $1`,
    [idReceta]
  );
  return rows[0];
}

async function traerIngredientes(idReceta) {
  const { rows } = await consultar(
    `SELECT d.id_insumo, d.cantidad_necesaria, d.id_unidad_medida, d.fase,
            i.nombre AS insumo, u.abreviatura AS unidad
       FROM receta_detalle d
       JOIN insumos i        ON i.id_insumo = d.id_insumo
       JOIN unidades_medida u ON u.id_unidad = d.id_unidad_medida
      WHERE d.id_receta = $1
      ORDER BY d.fase DESC, i.nombre`,
    [idReceta]
  );
  return rows;
}

// Los ingredientes llegan como listas paralelas, que es como manda un
// formulario con varias filas iguales. Las filas sin insumo elegido se
// descartan: son las que quedaron vacias al final.
function leerIngredientes(cuerpo, insumos, unidades) {
  const aLista = (valor) => (Array.isArray(valor) ? valor : valor === undefined ? [] : [valor]);
  const idsInsumo = aLista(cuerpo.id_insumo);
  const cantidades = aLista(cuerpo.cantidad_necesaria);
  const idsUnidad = aLista(cuerpo.id_unidad_medida);
  const fases = aLista(cuerpo.fase);

  const ingredientes = [];
  const errores = [];
  const vistos = new Set();

  for (let i = 0; i < idsInsumo.length; i += 1) {
    const idInsumo = Number(idsInsumo[i]);
    if (!idsInsumo[i]) continue;

    const insumo = insumos.find((x) => x.id_insumo === idInsumo);
    if (!insumo) {
      errores.push('Hay un ingrediente que no esta en la lista de insumos.');
      continue;
    }

    const cantidad = Number(String(cantidades[i] || '').replace(',', '.'));
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      errores.push('La cantidad de ' + insumo.nombre + ' tiene que ser un numero mayor que cero.');
      continue;
    }

    const unidad = unidades.find((u) => u.id_unidad === Number(idsUnidad[i]));
    if (!unidad) {
      errores.push('Elegi la unidad de ' + insumo.nombre + '.');
      continue;
    }
    if (unidad.magnitud !== insumo.magnitud) {
      errores.push(
        insumo.nombre + ' se compra por ' + insumo.unidad_compra + ', asi que no se puede pedir en ' +
        unidad.abreviatura + ': son familias distintas y no hay forma de convertir una en otra.'
      );
      continue;
    }

    const fase = fases[i];
    if (!FASES.some((f) => f.valor === fase)) {
      errores.push('Elegi en que momento entra ' + insumo.nombre + '.');
      continue;
    }

    // La base ya lo impide con un unique, pero el mensaje de PostgreSQL no le
    // dice nada a nadie. Un insumo si puede ir una vez en tina y otra en tacho.
    const clave = idInsumo + '|' + fase;
    if (vistos.has(clave)) {
      errores.push(insumo.nombre + ' esta dos veces en la misma fase. Sumá las cantidades en un solo renglon.');
      continue;
    }
    vistos.add(clave);

    ingredientes.push({ id_insumo: idInsumo, cantidad_necesaria: cantidad, id_unidad_medida: unidad.id_unidad, fase });
  }

  if (ingredientes.length === 0 && errores.length === 0) {
    errores.push('Una receta necesita al menos un ingrediente.');
  }
  return { ingredientes, errores };
}

function leerCabecera(cuerpo, unidades) {
  const errores = [];
  const rendimiento = Number(String(cuerpo.cantidad_rendimiento || '').replace(',', '.'));
  if (!Number.isFinite(rendimiento) || rendimiento <= 0) {
    errores.push('Poné cuanto rinde la formula completa: un numero mayor que cero.');
  }
  const unidad = unidades.find((u) => u.id_unidad === Number(cuerpo.id_unidad_rendimiento));
  if (!unidad) errores.push('Elegi en que unidad rinde la formula.');

  return {
    datos: { cantidad_rendimiento: rendimiento, id_unidad_rendimiento: unidad ? unidad.id_unidad : null },
    errores,
  };
}

router.get('/nueva', exigirEdicion, async (req, res, siguiente) => {
  try {
    const clase = req.query.clase === 'PRODUCTO' ? 'PRODUCTO' : 'SABOR';
    const candidato = await traerCandidato(clase, req.query.id);
    if (!candidato) return siguiente();

    res.render('recetas/formulario', {
      candidato,
      receta: { cantidad_rendimiento: '', id_unidad_rendimiento: '', version: 1 },
      ingredientes: [],
      insumos: await traerInsumos(),
      unidades: await traerUnidades(),
      FASES,
      errores: [],
      esNueva: true,
      abreVersion: false,
    });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/', exigirEdicion, async (req, res, siguiente) => {
  try {
    const clase = req.body.clase === 'PRODUCTO' ? 'PRODUCTO' : 'SABOR';
    const candidato = await traerCandidato(clase, req.body.id);
    if (!candidato) return siguiente();

    const insumos = await traerInsumos();
    const unidades = await traerUnidades();
    const cabecera = leerCabecera(req.body, unidades);
    const detalle = leerIngredientes(req.body, insumos, unidades);
    const errores = cabecera.errores.concat(detalle.errores);

    if (errores.length > 0) {
      return res.status(400).render('recetas/formulario', {
        candidato,
        receta: req.body,
        ingredientes: reconstruirParaVolver(req.body),
        insumos,
        unidades,
        FASES,
        errores,
        esNueva: true,
        abreVersion: false,
      });
    }

    await conTransaccion(async (ejecutar) => {
      const { rows } = await ejecutar(
        `INSERT INTO recetas
           (id_sabor_resultado, id_producto_resultado, cantidad_rendimiento, id_unidad_rendimiento)
         VALUES ($1, $2, $3, $4)
         RETURNING id_receta`,
        [
          clase === 'SABOR' ? candidato.id : null,
          clase === 'PRODUCTO' ? candidato.id : null,
          cabecera.datos.cantidad_rendimiento,
          cabecera.datos.id_unidad_rendimiento,
        ]
      );
      await insertarIngredientes(ejecutar, rows[0].id_receta, detalle.ingredientes);
    });

    req.session.aviso = 'Se guardo la formula de ' + candidato.nombre + '.';
    res.redirect('/recetas');
  } catch (error) {
    siguiente(error);
  }
});

function insertarIngredientes(ejecutar, idReceta, ingredientes) {
  return Promise.all(
    ingredientes.map((ing) =>
      ejecutar(
        `INSERT INTO receta_detalle
           (id_receta, id_insumo, fase, cantidad_necesaria, id_unidad_medida)
         VALUES ($1, $2, $3, $4, $5)`,
        [idReceta, ing.id_insumo, ing.fase, ing.cantidad_necesaria, ing.id_unidad_medida]
      )
    )
  );
}

// Cuando el formulario vuelve con errores hay que devolverlo con lo que la
// persona habia escrito, no en blanco: puede haber cargado quince renglones.
function reconstruirParaVolver(cuerpo) {
  const aLista = (valor) => (Array.isArray(valor) ? valor : valor === undefined ? [] : [valor]);
  const ids = aLista(cuerpo.id_insumo);
  const cantidades = aLista(cuerpo.cantidad_necesaria);
  const unidades = aLista(cuerpo.id_unidad_medida);
  const fases = aLista(cuerpo.fase);
  return ids.map((id, i) => ({
    id_insumo: Number(id) || '',
    cantidad_necesaria: cantidades[i] || '',
    id_unidad_medida: Number(unidades[i]) || '',
    fase: fases[i] || 'TINA',
  }));
}

router.get('/:id', async (req, res, siguiente) => {
  try {
    const receta = await traerReceta(req.params.id);
    if (!receta) return siguiente();

    const ingredientes = await traerIngredientes(receta.id_receta);

    // El empleado consulta, no edita: se le muestra la formula en modo lectura.
    if (!puedeEditar(req)) {
      return res.render('recetas/ver', { receta, ingredientes, FASES });
    }

    res.render('recetas/formulario', {
      candidato: { clase: receta.clase, id: receta.id_sabor_resultado || receta.id_producto_resultado, nombre: receta.nombre_resultado },
      receta,
      ingredientes,
      insumos: await traerInsumos(),
      unidades: await traerUnidades(),
      FASES,
      errores: [],
      esNueva: false,
      abreVersion: await yaSeUso(receta.id_receta),
    });
  } catch (error) {
    siguiente(error);
  }
});

router.post('/:id', exigirEdicion, async (req, res, siguiente) => {
  try {
    const receta = await traerReceta(req.params.id);
    if (!receta) return siguiente();
    if (receta.fecha_vigencia_hasta !== null) {
      return res.status(409).render('error', {
        titulo: 'Esa version ya esta cerrada',
        mensaje: 'Solo se puede editar la formula vigente.',
      });
    }

    const insumos = await traerInsumos();
    const unidades = await traerUnidades();
    const cabecera = leerCabecera(req.body, unidades);
    const detalle = leerIngredientes(req.body, insumos, unidades);
    const errores = cabecera.errores.concat(detalle.errores);

    const usada = await yaSeUso(receta.id_receta);

    if (errores.length > 0) {
      return res.status(400).render('recetas/formulario', {
        candidato: { clase: receta.clase, id: receta.id_sabor_resultado || receta.id_producto_resultado, nombre: receta.nombre_resultado },
        receta: Object.assign({}, receta, req.body),
        ingredientes: reconstruirParaVolver(req.body),
        insumos,
        unidades,
        FASES,
        errores,
        esNueva: false,
        abreVersion: usada,
      });
    }

    await conTransaccion(async (ejecutar) => {
      if (!usada) {
        // Nadie produjo con esta formula: se corrige encima.
        await ejecutar(
          'UPDATE recetas SET cantidad_rendimiento = $1, id_unidad_rendimiento = $2 WHERE id_receta = $3',
          [cabecera.datos.cantidad_rendimiento, cabecera.datos.id_unidad_rendimiento, receta.id_receta]
        );
        await ejecutar('DELETE FROM receta_detalle WHERE id_receta = $1', [receta.id_receta]);
        await insertarIngredientes(ejecutar, receta.id_receta, detalle.ingredientes);
        return;
      }

      // Ya se uso: se cierra hoy y se abre la version siguiente. El indice
      // unico solo admite una vigente por sabor, asi que cerrar va primero.
      await ejecutar(
        'UPDATE recetas SET fecha_vigencia_hasta = CURRENT_DATE WHERE id_receta = $1',
        [receta.id_receta]
      );
      const { rows } = await ejecutar(
        `INSERT INTO recetas
           (id_sabor_resultado, id_producto_resultado, version,
            cantidad_rendimiento, id_unidad_rendimiento)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id_receta`,
        [
          receta.id_sabor_resultado,
          receta.id_producto_resultado,
          receta.version + 1,
          cabecera.datos.cantidad_rendimiento,
          cabecera.datos.id_unidad_rendimiento,
        ]
      );
      await insertarIngredientes(ejecutar, rows[0].id_receta, detalle.ingredientes);
    });

    req.session.aviso = usada
      ? 'Se abrio la version ' + (receta.version + 1) + ' de ' + receta.nombre_resultado + '. La anterior queda en el historial.'
      : 'Se guardo la formula de ' + receta.nombre_resultado + '.';
    res.redirect('/recetas');
  } catch (error) {
    siguiente(error);
  }
});

module.exports = router;
