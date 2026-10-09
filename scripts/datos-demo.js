'use strict';

// Datos de demostracion (2026-10-09), para ver como quedan los graficos y
// las alertas con un uso real: ventas de mostrador de los ultimos 60 dias en
// las dos sucursales, cajas cerradas por turno, stock de productos e insumos
// y tachos de helado.
//
//   npm run demo:cargar    carga los datos
//   npm run demo:borrar    los borra todos, sin tocar nada mas
//
// Todo queda a nombre del usuario "demo.datos" (empleado "Datos de
// demostracion", inactivo: no puede entrar) y los lotes de helado con codigo
// DEMO-..., asi el borrado es exacto. No se usa en produccion: solo para
// mostrar el sistema.
//
// Las ventas se cargan con los triggers apagados (session_replication_role),
// porque las cajas de dias pasados ya estan cerradas y la base no deja
// agregarles ventas; por eso el stock de demostracion se carga aparte, con
// movimientos de AJUSTE.

const { Client } = require('pg');

const DIAS = 60;
const USUARIO = 'demo.datos';

const SQL_CARGAR = `
DO $$
DECLARE
  v_emp INT; v_usuario INT;
  v_suc RECORD; v_turno RECORD; v_dia DATE;
  v_abre TIMESTAMPTZ; v_cierra TIMESTAMPTZ; v_caja INT;
  v_n INT; i INT; j INT; v_venta INT; v_hora TIMESTAMPTZ;
  v_total NUMERIC; v_lineas INT; v_prod RECORD; v_cant INT;
  v_medio INT; v_r NUMERIC; v_canal TEXT; v_efectivo NUMERIC; v_anulada BOOLEAN;
  v_factor NUMERIC; v_sistema NUMERIC; v_declarado NUMERIC; v_peso_total NUMERIC;
  m_efectivo INT; m_debito INT; m_credito INT; m_transf INT;
  v_sab RECORD; v_lote INT; v_codigo TEXT; v_llenos INT;
BEGIN
  INSERT INTO empleados (nombre, apellido, activo) VALUES ('Datos', 'de demostración', false) RETURNING id_empleado INTO v_emp;
  INSERT INTO usuarios (id_empleado, id_rol, username, password_hash, activo)
  SELECT v_emp, id_rol, '${USUARIO}', '!no-entra-es-de-demostracion', false FROM roles WHERE nombre_rol = 'empleado'
  RETURNING id_usuario INTO v_usuario;

  SELECT id_medio_pago INTO m_efectivo FROM medios_pago WHERE afecta_caja_efectivo ORDER BY id_medio_pago LIMIT 1;
  SELECT id_medio_pago INTO m_debito FROM medios_pago WHERE nombre ILIKE 'D%bito%';
  SELECT id_medio_pago INTO m_credito FROM medios_pago WHERE nombre ILIKE 'Cr%dito%';
  SELECT id_medio_pago INTO m_transf FROM medios_pago WHERE nombre ILIKE 'Transf%';

  -- Productos a la venta con su precio y un peso segun la categoria: lo que
  -- mas se vende en una heladeria es helado (cucuruchos y termicos).
  CREATE TEMP TABLE demo_prod ON COMMIT DROP AS
  WITH base AS (
    SELECT p.id_producto, pr.precio, c.nombre AS cat,
           CASE c.nombre WHEN 'Cucuruchos' THEN 34 WHEN 'Térmicos' THEN 28 WHEN 'Cafetería' THEN 10
                         WHEN 'Impulsivos' THEN 10 WHEN 'Repostería' THEN 8 WHEN 'Familiar' THEN 5
                         WHEN 'Línea diet' THEN 3 ELSE 2 END AS peso_cat
      FROM productos p
      JOIN categorias c ON c.id_categoria = p.id_categoria
      JOIN precios pr ON pr.id_producto = p.id_producto AND pr.tipo_precio = 'MINORISTA' AND pr.fecha_vigencia_hasta IS NULL
     WHERE p.activo
  ), pesos AS (
    SELECT *, peso_cat::numeric / count(*) OVER (PARTITION BY cat) AS peso FROM base
  )
  SELECT id_producto, precio, sum(peso) OVER (ORDER BY id_producto) AS acumulado FROM pesos;
  SELECT max(acumulado) INTO v_peso_total FROM demo_prod;

  FOR v_suc IN SELECT id_sucursal, tiene_fabrica FROM sucursales WHERE activa ORDER BY id_sucursal LOOP
    FOR v_dia IN SELECT generate_series(current_date - ${DIAS}, current_date, interval '1 day')::date LOOP
      FOR v_turno IN SELECT * FROM turnos ORDER BY orden LOOP
        v_abre := v_dia + v_turno.hora_inicio;
        v_cierra := CASE WHEN v_turno.hora_fin < v_turno.hora_inicio THEN v_dia + 1 + v_turno.hora_fin ELSE v_dia + v_turno.hora_fin END;
        CONTINUE WHEN v_abre > now() - interval '20 minutes';
        IF v_cierra > now() THEN v_cierra := now(); END IF;

        -- Cuantas ventas: mas a la noche, los fines de semana, en Entre Rios,
        -- y un poco mas a medida que se acerca el verano.
        v_factor := (CASE v_turno.codigo WHEN 'TARDE_NOCHE' THEN 30 ELSE 18 END)
                  * (CASE extract(isodow FROM v_dia) WHEN 6 THEN 1.5 WHEN 7 THEN 1.45 WHEN 5 THEN 1.2 ELSE 1 END)
                  * (CASE WHEN v_suc.tiene_fabrica THEN 1.15 ELSE 0.85 END)
                  * (1 + (${DIAS} - (current_date - v_dia)) / ${DIAS}::numeric * 0.3)
                  * (0.8 + random() * 0.4)
                  * (extract(epoch FROM v_cierra - v_abre) / extract(epoch FROM (CASE WHEN v_turno.hora_fin < v_turno.hora_inicio THEN v_dia + 1 + v_turno.hora_fin ELSE v_dia + v_turno.hora_fin END) - v_abre));
        v_n := greatest(0, round(v_factor));

        INSERT INTO cajas (id_sucursal, turno, id_usuario_apertura, fecha_apertura, monto_apertura,
                           id_usuario_cierre, fecha_cierre, monto_cierre_declarado, monto_cierre_sistema)
        VALUES (v_suc.id_sucursal, v_turno.codigo, v_usuario, v_abre, 20000, v_usuario, v_cierra, 0, 0)
        RETURNING id_caja INTO v_caja;
        v_efectivo := 0;

        FOR i IN 1..v_n LOOP
          -- La hora: a la tarde se vende mas cerca del cierre; a la noche, en el medio.
          v_hora := v_abre + (v_cierra - v_abre) * (CASE v_turno.codigo WHEN 'MANANA_TARDE' THEN sqrt(random()) ELSE (random() + random()) / 2 END);
          v_r := random();
          v_canal := CASE WHEN v_r < 0.84 THEN 'MOSTRADOR' WHEN v_r < 0.90 THEN 'TELEFONO' ELSE 'PEDIDOSYA' END;
          INSERT INTO ventas (id_caja, id_usuario, id_sucursal, canal_venta, tipo_venta, fecha_hora)
          VALUES (v_caja, v_usuario, v_suc.id_sucursal, v_canal, 'MINORISTA', v_hora) RETURNING id_venta INTO v_venta;

          v_r := random();
          v_lineas := CASE WHEN v_r < 0.6 THEN 1 WHEN v_r < 0.9 THEN 2 ELSE 3 END;
          v_total := 0;
          FOR j IN 1..v_lineas LOOP
            SELECT id_producto, precio INTO v_prod FROM demo_prod WHERE acumulado >= random() * v_peso_total ORDER BY acumulado LIMIT 1;
            CONTINUE WHEN EXISTS (SELECT 1 FROM venta_detalle WHERE id_venta = v_venta AND id_producto = v_prod.id_producto);
            v_cant := CASE WHEN random() < 0.8 THEN 1 ELSE 2 END;
            INSERT INTO venta_detalle (id_venta, id_producto, cantidad, precio_unitario_aplicado)
            VALUES (v_venta, v_prod.id_producto, v_cant, v_prod.precio);
            v_total := v_total + v_cant * v_prod.precio;
          END LOOP;

          v_r := random();
          v_medio := CASE WHEN v_r < 0.40 THEN m_efectivo WHEN v_r < 0.65 THEN m_debito WHEN v_r < 0.75 THEN m_credito ELSE m_transf END;
          IF v_total > 0 THEN
            INSERT INTO pagos_venta (id_venta, id_medio_pago, id_caja, id_usuario, monto, fecha_hora)
            VALUES (v_venta, v_medio, v_caja, v_usuario, v_total, v_hora);
          END IF;

          v_anulada := random() < 0.02;
          IF v_anulada THEN
            UPDATE ventas SET fecha_anulacion = v_hora + interval '4 minutes', id_usuario_anulacion = v_usuario,
                              motivo_anulacion = 'Datos de demostración: venta anulada de ejemplo'
             WHERE id_venta = v_venta;
          ELSIF v_medio = m_efectivo THEN
            v_efectivo := v_efectivo + v_total;
          END IF;
        END LOOP;

        -- Cierre: casi siempre cuadra; a veces falta o sobra algo.
        v_sistema := 20000 + v_efectivo;
        v_declarado := CASE WHEN random() < 0.12 THEN greatest(0, v_sistema + round((random() - 0.65) * 40) * 100) ELSE v_sistema END;
        UPDATE cajas SET monto_cierre_sistema = v_sistema, monto_cierre_declarado = v_declarado WHERE id_caja = v_caja;
      END LOOP;
    END LOOP;

    -- Stock de productos e insumos de la sucursal.
    INSERT INTO movimientos_producto (id_producto, id_sucursal, tipo_movimiento, cantidad, id_usuario, observaciones)
    SELECT p.id_producto, v_suc.id_sucursal, 'AJUSTE',
           CASE WHEN p.tipo_origen = 'PRODUCIDO_DESDE_SABOR' THEN 2 + floor(random() * 11) ELSE 3 + floor(random() * 38) END,
           v_usuario, 'Datos de demostración'
      FROM productos p WHERE p.activo AND p.lleva_stock_propio;
    INSERT INTO movimientos_insumo (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_usuario, observaciones)
    SELECT i.id_insumo, v_suc.id_sucursal, 'AJUSTE',
           CASE WHEN u.magnitud = 'CONTEO' THEN 20 + floor(random() * 280) ELSE round((2 + random() * 58)::numeric, 1) END,
           v_usuario, 'Datos de demostración'
      FROM insumos i JOIN unidades_medida u ON u.id_unidad = i.id_unidad_medida WHERE i.activo;

    -- Tachos de helado: de la mayoria de los sabores, algunos con poca
    -- reserva y algunos por vencer, para que se vean las alertas.
    FOR v_sab IN SELECT id_sabor FROM sabores WHERE activo AND random() < (CASE WHEN v_suc.tiene_fabrica THEN 0.75 ELSE 0.5 END) LOOP
      v_codigo := 'DEMO-' || v_suc.id_sucursal || '-' || v_sab.id_sabor;
      INSERT INTO lotes (origen, codigo_lote, id_sabor, fecha_elaboracion, fecha_vencimiento)
      VALUES ('STOCK_INICIAL', v_codigo, v_sab.id_sabor, NULL,
              current_date + (CASE WHEN random() < 0.1 THEN 5 + floor(random() * 20) ELSE 40 + floor(random() * 130) END)::int)
      RETURNING id_lote INTO v_lote;
      v_llenos := floor(random() * 5);
      FOR j IN 1..v_llenos LOOP
        INSERT INTO tachos (id_lote, id_sucursal, codigo_barras, capacidad_litros, estado)
        VALUES (v_lote, v_suc.id_sucursal, v_codigo || '-' || j, 10, 'LLENO');
      END LOOP;
      IF random() < 0.85 THEN
        INSERT INTO tachos (id_lote, id_sucursal, codigo_barras, capacidad_litros, estado)
        VALUES (v_lote, v_suc.id_sucursal, v_codigo || '-pozo', 10, 'EN_POZO');
      END IF;
    END LOOP;
  END LOOP;
END $$;
`;

const SQL_BORRAR = `
CREATE TEMP TABLE demo_u ON COMMIT DROP AS SELECT id_usuario, id_empleado FROM usuarios WHERE username = '${USUARIO}';
CREATE TEMP TABLE demo_v ON COMMIT DROP AS SELECT id_venta FROM ventas WHERE id_usuario IN (SELECT id_usuario FROM demo_u);
CREATE TEMP TABLE demo_c ON COMMIT DROP AS SELECT id_caja FROM cajas WHERE id_usuario_apertura IN (SELECT id_usuario FROM demo_u);
DELETE FROM movimientos_producto WHERE id_usuario IN (SELECT id_usuario FROM demo_u) OR id_venta IN (SELECT id_venta FROM demo_v);
DELETE FROM movimientos_insumo WHERE id_usuario IN (SELECT id_usuario FROM demo_u) OR id_venta IN (SELECT id_venta FROM demo_v);
DELETE FROM pagos_venta WHERE id_venta IN (SELECT id_venta FROM demo_v);
DELETE FROM venta_detalle WHERE id_venta IN (SELECT id_venta FROM demo_v);
DELETE FROM ventas WHERE id_venta IN (SELECT id_venta FROM demo_v);
DELETE FROM egresos WHERE id_caja IN (SELECT id_caja FROM demo_c);
DELETE FROM cajas WHERE id_caja IN (SELECT id_caja FROM demo_c);
DELETE FROM tachos WHERE id_lote IN (SELECT id_lote FROM lotes WHERE codigo_lote LIKE 'DEMO-%');
DELETE FROM lotes WHERE codigo_lote LIKE 'DEMO-%';
DELETE FROM usuarios WHERE id_usuario IN (SELECT id_usuario FROM demo_u);
DELETE FROM empleados WHERE id_empleado IN (SELECT id_empleado FROM demo_u);
`;

async function principal() {
  const accion = process.argv[2];
  if (!['cargar', 'borrar'].includes(accion)) {
    console.error('Uso: npm run demo:cargar  o  npm run demo:borrar');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'produccion') {
    console.error('Los datos de demostración no se cargan en producción.');
    process.exit(1);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL, options: '-c timezone=America/Argentina/Tucuman' });
  await c.connect();
  try {
    const { rows: [ya] } = await c.query('SELECT count(*)::int AS n FROM usuarios WHERE username = $1', [USUARIO]);
    if (accion === 'cargar' && ya.n > 0) {
      console.error('Ya hay datos de demostración cargados. Para volver a cargarlos: npm run demo:borrar y después npm run demo:cargar.');
      process.exit(1);
    }
    if (accion === 'borrar' && ya.n === 0) {
      console.log('No hay datos de demostración para borrar.');
      return;
    }
    await c.query('BEGIN');
    await c.query('SET LOCAL session_replication_role = replica');
    await c.query(accion === 'cargar' ? SQL_CARGAR : SQL_BORRAR);
    await c.query('COMMIT');
    if (accion === 'cargar') {
      const { rows: [r] } = await c.query(
        `SELECT (SELECT count(*) FROM ventas v JOIN usuarios u ON u.id_usuario = v.id_usuario WHERE u.username = $1)::int AS ventas,
                (SELECT count(*) FROM cajas c JOIN usuarios u ON u.id_usuario = c.id_usuario_apertura WHERE u.username = $1)::int AS cajas,
                (SELECT count(*) FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote WHERE l.codigo_lote LIKE 'DEMO-%')::int AS tachos`,
        [USUARIO]
      );
      console.log('Datos de demostración cargados: ' + r.ventas + ' ventas en ' + r.cajas + ' turnos de caja, y ' + r.tachos + ' tachos. Para sacarlos: npm run demo:borrar');
    } else {
      console.log('Datos de demostración borrados.');
    }
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await c.end();
  }
}

principal().catch((error) => { console.error(error.message); process.exit(1); });
