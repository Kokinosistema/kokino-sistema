'use strict';

const express = require('express');
const { consultar, conTransaccion } = require('../db');
const { exigirRol } = require('../middleware/sesion');
const { CAMBIO_DE_SUCURSAL } = require('../sucursales');

const router = express.Router();

// Cargar stock (2026-10-05): lo que ya hay en la sucursal de trabajo cuando
// se empieza a usar el sistema. Lo hacen los duenos. Desde el 2026-10-07 no
// tiene pantalla propia en el menu: el helado se carga desde Fabricacion
// (/stock/helado) y lo contado de productos e insumos, desde sus listas
// (Productos e Insumos, boton "Cargar stock"), que mandan aca.
//
//   - Helado: los tachos llenos que estan en los freezers, con su sabor y el
//     vencimiento que figura en el tacho. Van en un lote de STOCK_INICIAL.
//     El tacho que esta abierto en el pozo no se carga: el primer "Cambiar
//     tacho" abre uno lleno y desde ahi el sistema lo sigue.
//   - Productos e insumos: se escribe cuanto hay contado y el sistema
//     registra la diferencia con lo que tenia. La primera vez es
//     STOCK_INICIAL; despues, RECUENTO. Asi un error se corrige contando de
//     nuevo.
router.use(exigirRol('administrador'));

const LITROS_POR_TACHO = 10;
const lista = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function hoyTexto() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function datos(idSucursal) {
  const { rows: sabores } = await consultar(
    `SELECT s.id_sabor, s.nombre || ' (' || lower(s.linea) || ')' AS nombre, c.nombre AS grupo
       FROM sabores s JOIN categorias c ON c.id_categoria = s.id_categoria
      WHERE s.activo
      ORDER BY c.nombre, s.nombre, s.linea`
  );
  // Las cargas de helado de esta sucursal, con cuantos tachos siguen llenos
  // (si todos siguen llenos y sin moverse, la carga todavia se puede borrar).
  const { rows: cargas } = await consultar(
    `SELECT l.id_lote, l.fecha_vencimiento, l.created_at, s.nombre || ' (' || lower(s.linea) || ')' AS sabor,
            count(t.id_tacho)::int AS tachos,
            count(t.id_tacho) FILTER (WHERE t.estado = 'LLENO')::int AS llenos,
            bool_and(t.estado = 'LLENO'
                     AND NOT EXISTS (SELECT 1 FROM traslado_tachos tt WHERE tt.id_tacho = t.id_tacho)
                     AND NOT EXISTS (SELECT 1 FROM venta_tachos vt WHERE vt.id_tacho = t.id_tacho)) AS se_puede_borrar
       FROM lotes l
       JOIN sabores s ON s.id_sabor = l.id_sabor
       JOIN tachos t ON t.id_lote = l.id_lote
      WHERE l.origen = 'STOCK_INICIAL'
      GROUP BY l.id_lote, s.nombre, s.linea
     HAVING bool_or(t.id_sucursal = $1)
      ORDER BY l.created_at DESC, s.nombre`,
    [idSucursal]
  );
  const { rows: productos } = await consultar(
    `SELECT p.id_producto AS id, p.nombre, c.nombre AS categoria,
            CASE WHEN p.tipo_origen = 'PRODUCIDO_DESDE_SABOR' THEN 'potes' ELSE lower(u.abreviatura) END AS unidad,
            u.magnitud = 'CONTEO' OR p.tipo_origen = 'PRODUCIDO_DESDE_SABOR' AS entero,
            coalesce((SELECT sum(m.cantidad) FROM movimientos_producto m WHERE m.id_producto = p.id_producto AND m.id_sucursal = $1), 0) AS stock,
            EXISTS (SELECT 1 FROM movimientos_producto m WHERE m.id_producto = p.id_producto AND m.id_sucursal = $1
                     AND m.tipo_movimiento = 'STOCK_INICIAL') AS ya_cargado
       FROM productos p
       JOIN categorias c ON c.id_categoria = p.id_categoria
       JOIN unidades_medida u ON u.id_unidad = p.id_unidad_medida
      WHERE p.activo AND p.lleva_stock_propio
      ORDER BY c.nombre, p.nombre`,
    [idSucursal]
  );
  const { rows: insumos } = await consultar(
    `SELECT i.id_insumo AS id, i.nombre, c.nombre AS categoria, lower(u.abreviatura) AS unidad,
            u.magnitud = 'CONTEO' AS entero,
            coalesce((SELECT sum(m.cantidad) FROM movimientos_insumo m WHERE m.id_insumo = i.id_insumo AND m.id_sucursal = $1), 0) AS stock,
            EXISTS (SELECT 1 FROM movimientos_insumo m WHERE m.id_insumo = i.id_insumo AND m.id_sucursal = $1
                     AND m.tipo_movimiento = 'STOCK_INICIAL') AS ya_cargado
       FROM insumos i
       JOIN categorias c ON c.id_categoria = i.id_categoria
       JOIN unidades_medida u ON u.id_unidad = i.id_unidad_medida
      WHERE i.activo
      ORDER BY c.nombre, i.nombre`,
    [idSucursal]
  );
  const conNumero = (f) => ({ ...f, stock: Number(f.stock) });
  return { sabores, cargas, productos: productos.map(conNumero), insumos: insumos.map(conNumero) };
}

async function mostrar(req, res, { helado = null, erroresHelado = [], estado = 200 } = {}) {
  const { sabores, cargas } = await datos(req.sucursal.id_sucursal);
  res.status(estado).render('stock/helado', {
    sabores, cargas, helado: helado || { renglones: [] }, erroresHelado, hoy: hoyTexto(), LITROS_POR_TACHO,
  });
}

// La pantalla vieja de Cargar stock lleva a la carga de helado.
router.get('/', (req, res) => res.redirect('/stock/helado'));

router.get('/helado', async (req, res, siguiente) => {
  try {
    await mostrar(req, res);
  } catch (error) {
    siguiente(error);
  }
});

// ---------------------------------------------------------------------------
// Helado: los tachos que ya estan en los freezers

router.post('/helado', async (req, res, siguiente) => {
  try {
    if (Number(req.body.id_sucursal) !== req.sucursal.id_sucursal) {
      req.session.aviso = CAMBIO_DE_SUCURSAL;
      return res.redirect('/stock/helado');
    }
    const { sabores } = await datos(req.sucursal.id_sucursal);
    const helado = {
      renglones: lista(req.body.renglon_sabor).map((s, i) => ({
        id_sabor: String(s),
        cantidad: String(lista(req.body.renglon_cantidad)[i] || '').trim(),
        vence: String(lista(req.body.renglon_vence)[i] || '').trim(),
      })),
    };
    const errores = [];
    const renglones = [];
    for (const r of helado.renglones) {
      const sabor = sabores.find((s) => s.id_sabor === Number(r.id_sabor));
      if (!sabor) { errores.push('Un sabor de la lista ya no existe: sacalo.'); continue; }
      if (!/^\d{1,3}$/.test(r.cantidad) || Number(r.cantidad) < 1) { errores.push('La cantidad de tachos de ' + sabor.nombre + ' es un número entero.'); continue; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.vence) || Number.isNaN(Date.parse(r.vence))) { errores.push('Poné cuándo vencen los tachos de ' + sabor.nombre + '.'); continue; }
      renglones.push({ id_sabor: sabor.id_sabor, sabor: sabor.nombre, cantidad: Number(r.cantidad), vence: r.vence });
    }
    if (helado.renglones.length === 0) errores.push('Agregá los tachos que hay.');
    if (errores.length > 0) return mostrar(req, res, { helado, erroresHelado: errores, estado: 400 });

    const total = await conTransaccion(async (ejecutar) => {
      let n = 0;
      for (const r of renglones) {
        // Un lote por sabor y vencimiento, con un codigo para cada tacho.
        const { rows: [lote] } = await ejecutar(
          `INSERT INTO lotes (origen, codigo_lote, id_sabor, fecha_elaboracion, fecha_vencimiento)
           VALUES ('STOCK_INICIAL', 'INI-pendiente-' || gen_random_uuid(), $1, NULL, $2::date)
           RETURNING id_lote`,
          [r.id_sabor, r.vence]
        );
        const codigo = 'INI' + r.vence.replace(/-/g, '') + '-' + lote.id_lote;
        await ejecutar('UPDATE lotes SET codigo_lote = $1 WHERE id_lote = $2', [codigo, lote.id_lote]);
        for (let i = 1; i <= r.cantidad; i += 1) {
          await ejecutar(
            'INSERT INTO tachos (id_lote, id_sucursal, codigo_barras, capacidad_litros) VALUES ($1, $2, $3, $4)',
            [lote.id_lote, req.sucursal.id_sucursal, codigo + '-' + String(i).padStart(2, '0'), LITROS_POR_TACHO]
          );
          n += 1;
        }
      }
      return n;
    });
    req.session.aviso = 'Se cargaron ' + total + (total === 1 ? ' tacho' : ' tachos') + ' al stock de ' + req.sucursal.nombre + '.';
    res.redirect('/stock/helado');
  } catch (error) {
    siguiente(error);
  }
});

// Borrar una carga de helado mal hecha, mientras ninguno de sus tachos se
// haya abierto, enviado ni vendido.
router.post('/helado/:id/borrar', async (req, res, siguiente) => {
  try {
    const id = Number(req.params.id);
    const { cargas } = await datos(req.sucursal.id_sucursal);
    const carga = cargas.find((c) => c.id_lote === id);
    if (!carga) return siguiente();
    if (!carga.se_puede_borrar) {
      req.session.aviso = 'Esa carga ya no se puede borrar: algún tacho se abrió, se envió o se vendió.';
      return res.redirect('/stock/helado');
    }
    await conTransaccion(async (ejecutar) => {
      await ejecutar('DELETE FROM tachos WHERE id_lote = $1', [id]);
      await ejecutar("DELETE FROM lotes WHERE id_lote = $1 AND origen = 'STOCK_INICIAL'", [id]);
    });
    req.session.aviso = 'Se borró la carga de ' + carga.tachos + (carga.tachos === 1 ? ' tacho' : ' tachos') + ' de ' + carga.sabor + '.';
    res.redirect('/stock/helado');
  } catch (error) {
    siguiente(error);
  }
});

// ---------------------------------------------------------------------------
// Productos e insumos: cuanto hay contado

// Lo contado de productos o de insumos, desde su lista. Si hay errores,
// vuelve a la lista en modo carga con lo escrito y los errores.
const LISTAS = { producto: '/productos', insumo: '/insumos' };

router.post('/contado/:tipo', async (req, res, siguiente) => {
  try {
    const tipo = req.params.tipo;
    const volver = LISTAS[tipo];
    if (!volver) return siguiente();
    if (Number(req.body.id_sucursal) !== req.sucursal.id_sucursal) {
      req.session.aviso = CAMBIO_DE_SUCURSAL;
      return res.redirect(volver);
    }
    const todo = await datos(req.sucursal.id_sucursal);
    const filas = tipo === 'producto' ? todo.productos : todo.insumos;
    const valores = {};
    const errores = [];
    const cambios = [];
    for (const f of filas) {
      const clave = tipo + '_' + f.id;
      const texto = typeof req.body[clave] === 'string' ? req.body[clave].trim() : '';
      if (texto === '') continue;
      valores[clave] = texto;
      const patron = f.entero ? /^\d{1,6}$/ : /^\d{1,6}(,\d{1,3})?$/;
      if (!patron.test(texto)) {
        errores.push('Lo contado de "' + f.nombre + '" ' + (f.entero ? 'es un número entero (' + f.unidad + ').' : 'va en ' + f.unidad + ', con coma para los decimales (por ejemplo: 2,5).'));
        continue;
      }
      const contado = Number(texto.replace(',', '.'));
      const diferencia = Math.round((contado - f.stock) * 1000) / 1000;
      if (diferencia === 0) continue;
      cambios.push({ id: f.id, diferencia, inicial: !f.ya_cargado && diferencia > 0 });
    }
    if (errores.length > 0) {
      req.session.contado = { tipo, valores, errores };
      return res.redirect(volver + '?cargar=1');
    }
    if (cambios.length === 0) {
      req.session.aviso = Object.keys(valores).length === 0 ? 'No escribiste nada contado.' : 'Lo contado coincide con lo que ya había: no hubo nada para cambiar.';
      return res.redirect(volver);
    }
    const tabla = tipo === 'producto' ? 'movimientos_producto' : 'movimientos_insumo';
    const columna = tipo === 'producto' ? 'id_producto' : 'id_insumo';
    await conTransaccion(async (ejecutar) => {
      for (const c of cambios) {
        await ejecutar(
          `INSERT INTO ${tabla} (${columna}, id_sucursal, tipo_movimiento, cantidad, id_usuario, observaciones)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [c.id, req.sucursal.id_sucursal, c.inicial ? 'STOCK_INICIAL' : 'RECUENTO', c.diferencia,
            req.session.usuario.id_usuario, c.inicial ? 'Stock inicial' : 'Recuento desde Cargar stock']
        );
      }
    });
    req.session.aviso = 'Se actualizó el stock de ' + cambios.length + (cambios.length === 1 ? (tipo === 'producto' ? ' producto' : ' insumo') : (tipo === 'producto' ? ' productos' : ' insumos')) + ' en ' + req.sucursal.nombre + '.';
    res.redirect(volver);
  } catch (error) {
    siguiente(error);
  }
});

// Para las listas de Productos e Insumos en modo carga: unidad, si va en
// enteros y si ya tiene stock inicial, de cada uno.
async function filasParaContar(tipo, idSucursal) {
  const todo = await datos(idSucursal);
  const filas = tipo === 'producto' ? todo.productos : todo.insumos;
  return Object.fromEntries(filas.map((f) => [f.id, f]));
}

module.exports = router;
module.exports.filasParaContar = filasParaContar;
