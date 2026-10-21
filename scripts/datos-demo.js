'use strict';

// Datos de demostracion (2026-10-09, ampliados el 2026-10-16), para ver como
// queda el sistema funcionando con un uso real:
//
// - ventas de mostrador de los ultimos 60 dias en las dos sucursales, con
//   cajas cerradas por turno y algunos egresos;
// - stock de productos e insumos y tachos de helado;
// - lo que todavia no cargaron los duenos, inventado: clientes mayoristas,
//   precios mayoristas, costos de los productos y de los insumos que no
//   tienen, insumos de los productos de cafeteria y de los postres que se
//   arman al vender, y recetas de los sabores;
// - la operacion de los ultimos 30 dias: fabricacion, envios a Alem, ventas
//   mayoristas con su cuenta corriente, devoluciones de envases e ingresos de
//   mercaderia de los proveedores.
//
//   npm run demo:cargar    carga los datos
//   npm run demo:borrar    los borra todos, sin tocar nada mas
//
// Como se reconoce lo ficticio para borrarlo exacto:
// - lo operativo queda a nombre del usuario "demo.datos" (empleado "Datos de
//   demostracion", inactivo: no puede entrar);
// - los lotes de helado tienen codigo DEMO-...;
// - lo que va a tablas que ya tienen datos reales (costos de productos e
//   insumos, insumos de productos, recetas, clientes) se reconoce por su created_at: todo se carga
//   en una sola transaccion, y now() es el mismo durante toda la transaccion,
//   asi que esas filas tienen exactamente el created_at del usuario demo.
//
// Si mientras estan cargados se registra algo real que use un dato ficticio
// (una venta a un cliente "Demo"), el borrado falla entero en vez de dejar
// la base a medias: la base no deja borrar algo que otra fila todavia usa.
//
// No se usa en produccion: solo para mostrar el sistema.
//
// Se carga en dos tandas dentro de la misma transaccion:
// 1. Con los triggers apagados (ver apagarTriggers, mas abajo): el
//    historial de mostrador, porque las cajas de dias pasados ya estan
//    cerradas y la base no deja agregarles ventas ni egresos; por eso el stock
//    de demostracion se carga aparte, con movimientos de AJUSTE. El catalogo
//    tambien va aca.
// 2. Con los triggers prendidos: fabricacion, envios, ventas mayoristas e
//    ingresos. Asi es la base la que mueve los tachos y el stock, como cuando
//    se usa el sistema, y esos datos pasan por las mismas reglas que los
//    reales.

const { Client } = require('pg');

const DIAS = 60;
const DIAS_OPERACION = 30;
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
  v_egresos NUMERIC; v_monto NUMERIC; v_tipo TEXT; v_desc TEXT; v_empleado INT;
  v_receta INT; v_lt INT; v_gr INT; v_un INT;
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

        -- Egresos: en uno de cada cuatro turnos sale algo de plata. Solo el
        -- efectivo baja lo que tiene que haber en el cajon, y nunca sale mas
        -- de lo que hay.
        v_egresos := 0;
        IF random() < 0.25 THEN
          v_r := random();
          v_tipo := CASE WHEN v_r < 0.45 THEN 'COMPRA' WHEN v_r < 0.65 THEN 'SERVICIO' WHEN v_r < 0.85 THEN 'RETIRO_EMPLEADO' ELSE 'OTRO' END;
          v_desc := CASE v_tipo
            WHEN 'COMPRA' THEN (ARRAY['Hielo', 'Servilletas y cucharitas', 'Artículos de limpieza', 'Bolsas', 'Leche para el café'])[1 + floor(random() * 5)::int]
            WHEN 'SERVICIO' THEN (ARRAY['Delivery', 'Cerrajero', 'Técnico de la heladera'])[1 + floor(random() * 3)::int]
            WHEN 'RETIRO_EMPLEADO' THEN 'Adelanto'
            ELSE 'Cambio para el cajón' END || ' (dato de demostración)';
          v_monto := CASE v_tipo WHEN 'RETIRO_EMPLEADO' THEN 5000 + floor(random() * 6) * 5000 ELSE 1500 + floor(random() * 18) * 1000 END;
          v_empleado := NULL;
          IF v_tipo = 'RETIRO_EMPLEADO' THEN
            SELECT id_empleado INTO v_empleado FROM empleados
             WHERE activo AND (id_sucursal_asignada = v_suc.id_sucursal OR id_sucursal_asignada IS NULL)
             ORDER BY random() LIMIT 1;
          END IF;
          IF (v_tipo <> 'RETIRO_EMPLEADO' OR v_empleado IS NOT NULL) AND v_monto <= 20000 + v_efectivo THEN
            v_medio := CASE WHEN random() < 0.85 THEN m_efectivo ELSE m_transf END;
            INSERT INTO egresos (id_caja, id_medio_pago, id_usuario, id_empleado, tipo_egreso, monto, descripcion, fecha_hora)
            VALUES (v_caja, v_medio, v_usuario, v_empleado, v_tipo, v_monto, v_desc, v_abre + (v_cierra - v_abre) * random());
            IF v_medio = m_efectivo THEN v_egresos := v_monto; END IF;
          END IF;
        END IF;

        -- Cierre: casi siempre cuadra; a veces falta o sobra algo.
        v_sistema := 20000 + v_efectivo - v_egresos;
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

  -- ------------------------------------------------ Catalogo que falta

  -- Clientes mayoristas, con "Demo" en el nombre para que se reconozcan.
  INSERT INTO clientes (nombre_razon_social, tipo_cliente, telefono, direccion, limite_cuenta_corriente, plazo_pago_dias) VALUES
    ('Demo · Kiosco La Esquina',      'MAYORISTA', '381 400-0001', 'Av. Mate de Luna 1200 (ficticia)', 600000, 15),
    ('Demo · Almacén Don Tito',       'MAYORISTA', '381 400-0002', 'San Juan 850 (ficticia)',          400000, 30),
    ('Demo · Heladería del Parque',   'MAYORISTA', '381 400-0003', 'Av. Soldati 300 (ficticia)',      1500000, 30),
    ('Demo · Despensa San Cayetano',  'MAYORISTA', '381 400-0004', 'Av. Roca 2100 (ficticia)',         300000,  7),
    ('Demo · Bar El Molino',          'MAYORISTA', '381 400-0005', 'Yerba Buena (ficticia)',           800000, 15);

  -- Precios mayoristas por tacho de 10 L, solo si todavia no hay reales.
  IF NOT EXISTS (SELECT 1 FROM precios_mayoristas WHERE fecha_vigencia_hasta IS NULL) THEN
    INSERT INTO precios_mayoristas (linea, envase, precio, fecha_vigencia_desde, id_usuario) VALUES
      ('ARTESANAL', 'INCLUIDO',   140000, current_date - ${DIAS}, v_usuario),
      ('ARTESANAL', 'RETORNABLE', 125000, current_date - ${DIAS}, v_usuario),
      ('FAMILIAR',  'INCLUIDO',   100000, current_date - ${DIAS}, v_usuario),
      ('FAMILIAR',  'RETORNABLE',  88000, current_date - ${DIAS}, v_usuario);
  END IF;

  -- Costo de los productos que no lo tienen: una parte del precio de venta.
  INSERT INTO costos_producto (id_producto, costo, fecha_vigencia_desde)
  SELECT p.id_producto,
         round(pr.precio * (CASE WHEN p.tipo_origen = 'COMPRADO_TERMINADO' THEN 0.55 + random() * 0.1 ELSE 0.28 + random() * 0.14 END)::numeric, -1),
         current_date - ${DIAS}
    FROM productos p
    JOIN precios pr ON pr.id_producto = p.id_producto AND pr.tipo_precio = 'MINORISTA' AND pr.fecha_vigencia_hasta IS NULL
   WHERE p.activo
     AND NOT EXISTS (SELECT 1 FROM costos_producto c WHERE c.id_producto = p.id_producto AND c.fecha_vigencia_hasta IS NULL);

  -- Costo de los insumos que no estan en la planilla de formulaciones
  -- (cucuruchos, envases, cafe y algunas materias primas), segun su unidad.
  INSERT INTO costos_insumo (id_insumo, costo, fecha_vigencia_desde)
  SELECT i.id_insumo,
         round((CASE um.abreviatura WHEN 'un' THEN 60 + random() * 340 ELSE 4000 + random() * 11000 END)::numeric, -1),
         current_date - ${DIAS}
    FROM insumos i
    JOIN unidades_medida um ON um.id_unidad = i.id_unidad_medida
   WHERE i.activo
     AND NOT EXISTS (SELECT 1 FROM costos_insumo c WHERE c.id_insumo = i.id_insumo AND c.fecha_vigencia_hasta IS NULL);

  -- Insumos de los productos de cafeteria y de los postres que se arman al
  -- vender (los demas productos no tienen un insumo cargado que les
  -- corresponda, como el envase del pote familiar).
  SELECT id_unidad INTO v_gr FROM unidades_medida WHERE abreviatura = 'gr';
  SELECT id_unidad INTO v_un FROM unidades_medida WHERE abreviatura = 'un';
  INSERT INTO producto_insumos (id_producto, id_insumo, cantidad, id_unidad_medida)
  SELECT p.id_producto, i.id_insumo, d.cantidad, CASE WHEN d.unidad = 'gr' THEN v_gr ELSE v_un END
    FROM (VALUES ('Café chico', 'Café (bolsas de 1/2 kg)', 10, 'gr'),
                 ('Jarrito', 'Café (bolsas de 1/2 kg)', 14, 'gr'),
                 ('Jarrito y alfajor', 'Café (bolsas de 1/2 kg)', 14, 'gr'),
                 ('Affogato', 'Café (bolsas de 1/2 kg)', 10, 'gr'),
                 ('Affogato', 'Vasito', 1, 'un'),
                 ('Baño de chocolate', 'Cobertura amarga', 30, 'gr'),
                 ('Brownie con helado', 'Vaso', 1, 'un'),
                 ('Brownie con helado', 'Cobertura amarga', 20, 'gr'),
                 ('Volcán con helado', 'Vaso', 1, 'un')) AS d (producto, insumo, cantidad, unidad)
    JOIN productos p ON p.nombre = d.producto
    JOIN insumos i ON i.nombre = d.insumo
   WHERE NOT EXISTS (SELECT 1 FROM producto_insumos x WHERE x.id_producto = p.id_producto AND x.id_insumo = i.id_insumo);

  -- Recetas de los sabores que no tienen, para 10 L (un tacho). Cada sabor
  -- lleva la base de su categoria y lo propio del sabor; lo que se agrega al
  -- llenar el tacho (granizado, galletitas, nueces) va en la fase TACHO. Los
  -- patrones se buscan en "sabor | categoria". Las cantidades son inventadas.
  SELECT id_unidad INTO v_lt FROM unidades_medida WHERE abreviatura = 'lt';
  CREATE TEMP TABLE demo_ing (patron TEXT, insumo TEXT, cantidad NUMERIC, fase TEXT) ON COMMIT DROP;
  INSERT INTO demo_ing VALUES
    ('\\| Frutales al agua$', 'Azúcar', 2.2, 'TINA'),
    ('\\| Frutales al agua$', 'Neutro', 0.05, 'TINA'),
    ('\\| (Frutales a la crema|Chocolate|Cremas|Dulce de leche)$', 'Leche en polvo', 1.2, 'TINA'),
    ('\\| (Frutales a la crema|Chocolate|Cremas|Dulce de leche)$', 'Azúcar', 1.6, 'TINA'),
    ('\\| (Frutales a la crema|Chocolate|Cremas|Dulce de leche)$', 'Crema de leche', 1.0, 'TINA'),
    ('\\| (Frutales a la crema|Chocolate|Cremas|Dulce de leche)$', 'Neutro', 0.05, 'TINA'),
    ('\\| Diet$', 'Leche en polvo', 1.2, 'TINA'),
    ('\\| Diet$', 'Neutro', 0.06, 'TINA'),
    ('^Ananá', 'Pulpa de ananá', 2.5, 'TINA'),
    ('champagne', 'Champagne', 0.5, 'TINA'),
    ('^Durazno', 'Pulpa de durazno', 2.5, 'TINA'),
    ('^Frutilla', 'Pulpa de frutilla', 2.5, 'TINA'),
    ('^(Limón|Citrus|Mousse de limón)', 'Limón', 1.5, 'TINA'),
    ('^Mousse', 'Estabilizante mousse', 0.1, 'TINA'),
    ('^Arándanos', 'Pasta de arándanos', 0.3, 'TINA'),
    ('^Banana', 'Banana', 2.0, 'TINA'),
    ('^Banana', 'Estabilizante de banana', 0.1, 'TINA'),
    ('^Cereza', 'Cerezas', 1.0, 'TINA'),
    ('maraschino', 'Maraschino', 1, 'TINA'),
    ('^Higos', 'Higos', 1.0, 'TINA'),
    ('^Kinotos', 'Kinotos', 1.0, 'TINA'),
    ('^Frutos del bosque', 'Variegato de frutos rojos', 0.8, 'TACHO'),
    ('^Melón', 'Pasta de melón', 0.3, 'TINA'),
    ('^(Chocolate|Bombón)', 'Cacao', 0.6, 'TINA'),
    ('^(Chocolate|Bombón)', 'Estabilizante chocolate', 0.1, 'TINA'),
    ('^Chocolate blanco', 'Cobertura blanca', 1.0, 'TINA'),
    ('^Chocolate amargo', 'Cobertura amarga', 0.8, 'TINA'),
    ('almendra', 'Almendras', 0.5, 'TACHO'),
    ('^Almendrado', 'Crocante', 0.3, 'TACHO'),
    ('^Bombón Rocher', 'Nutelina base', 0.6, 'TINA'),
    ('maracuyá', 'Pasta de maracuyá', 0.4, 'TINA'),
    ('^(Vainilla|Americana)', 'Pasta de vainilla', 0.15, 'TINA'),
    ('^(Vainilla|Americana)', 'Estabilizante vainilla', 0.1, 'TINA'),
    ('^Crema del cielo', 'Estabilizante chantilly', 0.1, 'TINA'),
    ('^Kokicukis', 'Oreo', 3, 'TACHO'),
    ('granizad|^Granizado', 'Chocolate para granizar', 0.4, 'TACHO'),
    ('^Sambayón', 'Pasta de sambayón', 0.3, 'TINA'),
    ('^Chocotorta', 'Galletas Chocolinas', 0.5, 'TACHO'),
    ('^(Chocotorta|Crema Kokino)', 'Dulce de leche heladero', 0.8, 'TINA'),
    ('^Dulce de leche', 'Dulce de leche heladero', 2.0, 'TINA'),
    ('con nuez', 'Nueces', 0.4, 'TACHO'),
    ('goloso', 'Dulce de leche repostero', 0.6, 'TACHO'),
    ('irlandesa', 'Licor seco', 1, 'TINA');

  FOR v_sab IN
    SELECT s.id_sabor, s.nombre || ' | ' || c.nombre AS texto
      FROM sabores s JOIN categorias c ON c.id_categoria = s.id_categoria
     WHERE s.activo
       AND NOT EXISTS (SELECT 1 FROM recetas r WHERE r.id_sabor_resultado = s.id_sabor AND r.fecha_vigencia_hasta IS NULL)
  LOOP
    INSERT INTO recetas (id_sabor_resultado, cantidad_rendimiento, id_unidad_rendimiento, fecha_vigencia_desde)
    VALUES (v_sab.id_sabor, 10, v_lt, current_date - ${DIAS})
    RETURNING id_receta INTO v_receta;
    INSERT INTO receta_detalle (id_receta, id_insumo, fase, cantidad_necesaria, id_unidad_medida)
    SELECT DISTINCT ON (i.id_insumo, d.fase) v_receta, i.id_insumo, d.fase, d.cantidad, i.id_unidad_medida
      FROM demo_ing d JOIN insumos i ON i.nombre = d.insumo
     WHERE v_sab.texto ~* d.patron
     ORDER BY i.id_insumo, d.fase, d.cantidad DESC;
  END LOOP;
END $$;
`;

// Segunda tanda, con los triggers prendidos: la operacion de los ultimos
// DIAS_OPERACION dias, dia por dia, para que cada envio o venta mayorista
// use tachos que ya se habian fabricado.
const SQL_OPERAR = `
DO $$
DECLARE
  v_usuario INT; v_fab INT; v_otra INT; v_dia DATE; v_hora TIMESTAMPTZ;
  v_sab RECORD; v_t RECORD; v_p RECORD; v_receta INT; v_prod INT; v_lote INT;
  v_codigo TEXT; v_tachos INT; i INT; j INT; v_envio INT; v_n INT; v_stock NUMERIC;
  v_cli INT; v_linea TEXT; v_envase TEXT; v_precio NUMERIC; v_venta INT; v_total NUMERIC;
  v_r NUMERIC; v_medio INT; m_efectivo INT; m_transf INT; v_ingreso INT;
  v_proveedor INT; v_semana INT;
BEGIN
  SELECT id_usuario INTO v_usuario FROM usuarios WHERE username = '${USUARIO}';
  SELECT id_sucursal INTO v_fab FROM sucursales WHERE activa AND tiene_fabrica ORDER BY id_sucursal LIMIT 1;
  SELECT id_sucursal INTO v_otra FROM sucursales WHERE activa AND id_sucursal <> v_fab ORDER BY id_sucursal LIMIT 1;
  SELECT id_medio_pago INTO m_efectivo FROM medios_pago WHERE afecta_caja_efectivo ORDER BY id_medio_pago LIMIT 1;
  SELECT id_medio_pago INTO m_transf FROM medios_pago WHERE nombre ILIKE 'Transf%';

  FOR v_dia IN SELECT generate_series(current_date - ${DIAS_OPERACION}, current_date - 1, interval '1 day')::date LOOP
    CONTINUE WHEN extract(isodow FROM v_dia) = 7;  -- los domingos no se fabrica ni se envia

    -- Fabricacion: una o dos tandas de helado por dia, mas seguido de la
    -- linea familiar, que es la que se llevan los mayoristas.
    FOR i IN 1..(1 + (random() < 0.6)::int) LOOP
      -- La linea se sortea antes: dentro del WHERE, random() se volveria a
      -- sortear en cada fila.
      v_linea := CASE WHEN random() < 0.4 THEN 'FAMILIAR' ELSE 'ARTESANAL' END;
      SELECT s.id_sabor, s.linea INTO v_sab FROM sabores s
       WHERE s.activo AND s.linea = v_linea
       ORDER BY random() LIMIT 1;
      SELECT id_receta INTO v_receta FROM recetas WHERE id_sabor_resultado = v_sab.id_sabor AND fecha_vigencia_hasta IS NULL;
      v_tachos := CASE WHEN v_sab.linea = 'FAMILIAR' THEN 4 + floor(random() * 5) ELSE 2 + floor(random() * 4) END;
      INSERT INTO produccion (id_sabor, id_receta, id_sucursal, id_usuario_responsable, fecha_produccion, cantidad_teorica, cantidad_real)
      VALUES (v_sab.id_sabor, v_receta, v_fab, v_usuario, v_dia + time '08:00' + random() * interval '3 hours', v_tachos * 10, v_tachos * 10)
      RETURNING id_produccion INTO v_prod;
      v_codigo := 'DEMO-L' || to_char(v_dia, 'YYYYMMDD') || '-' || v_prod;
      INSERT INTO lotes (id_produccion, codigo_lote, fecha_elaboracion, fecha_vencimiento)
      VALUES (v_prod, v_codigo, v_dia, v_dia + interval '6 months') RETURNING id_lote INTO v_lote;
      FOR j IN 1..v_tachos LOOP
        INSERT INTO tachos (id_lote, id_sucursal, codigo_barras, capacidad_litros) VALUES (v_lote, v_fab, v_codigo || '-' || lpad(j::text, 2, '0'), 10);
      END LOOP;
    END LOOP;

    -- Cada tanto, potes familiares o diet, o palitos.
    IF random() < 0.3 THEN
      SELECT p.id_producto, c.nombre AS cat INTO v_p FROM productos p JOIN categorias c ON c.id_categoria = p.id_categoria
       WHERE p.activo AND p.lleva_stock_propio AND p.tipo_origen IN ('PRODUCIDO_DIRECTO', 'PRODUCIDO_DESDE_SABOR')
       ORDER BY random() LIMIT 1;
      INSERT INTO produccion (id_producto, id_sucursal, id_usuario_responsable, fecha_produccion, cantidad_teorica, cantidad_real)
      VALUES (v_p.id_producto, v_fab, v_usuario, v_dia + time '12:00',
              CASE WHEN v_p.cat = 'Impulsivos' THEN 40 + floor(random() * 80) ELSE 6 + floor(random() * 15) END,
              CASE WHEN v_p.cat = 'Impulsivos' THEN 40 + floor(random() * 80) ELSE 6 + floor(random() * 15) END);
    END IF;

    -- Envios a la otra sucursal, dia por medio: tachos artesanales y algun
    -- producto. Casi siempre llega todo; a veces falta algo.
    IF v_otra IS NOT NULL AND extract(doy FROM v_dia)::int % 2 = 0 THEN
      v_hora := v_dia + time '15:00';
      INSERT INTO traslados (id_sucursal_origen, id_sucursal_destino, id_usuario, fecha_envio, observaciones)
      VALUES (v_fab, v_otra, v_usuario, v_hora, CASE WHEN random() < 0.3 THEN 'Dato de demostración' END)
      RETURNING id_traslado INTO v_envio;
      FOR v_t IN
        SELECT t.id_tacho FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote JOIN sabores s ON s.id_sabor = l.id_sabor
         WHERE t.id_sucursal = v_fab AND t.estado = 'LLENO' AND s.linea = 'ARTESANAL'
           AND l.codigo_lote LIKE 'DEMO-L%' AND l.fecha_elaboracion <= v_dia
         ORDER BY random() LIMIT (3 + floor(random() * 6))::int
      LOOP
        INSERT INTO traslado_tachos (id_traslado, id_tacho) VALUES (v_envio, v_t.id_tacho);
      END LOOP;
      FOR v_p IN
        SELECT p.id_producto, sum(m.cantidad) AS stock FROM productos p
          JOIN movimientos_producto m ON m.id_producto = p.id_producto AND m.id_sucursal = v_fab
         WHERE p.activo AND p.lleva_stock_propio AND p.tipo_origen <> 'COMPRADO_TERMINADO'
         GROUP BY p.id_producto HAVING sum(m.cantidad) >= 10
         ORDER BY random() LIMIT (1 + floor(random() * 3))::int
      LOOP
        INSERT INTO traslado_productos (id_traslado, id_producto, cantidad)
        VALUES (v_envio, v_p.id_producto, least(floor(v_p.stock / 2), 4 + floor(random() * 12)));
      END LOOP;

      IF NOT EXISTS (SELECT 1 FROM traslado_tachos WHERE id_traslado = v_envio)
         AND NOT EXISTS (SELECT 1 FROM traslado_productos WHERE id_traslado = v_envio) THEN
        UPDATE traslados SET estado = 'CANCELADO', fecha_cancelacion = v_hora + interval '5 minutes',
                             id_usuario_cancelacion = v_usuario, motivo_cancelacion = 'No había nada para enviar (dato de demostración)'
         WHERE id_traslado = v_envio;
      ELSIF v_dia < current_date - 1 THEN
        UPDATE traslado_tachos SET recibido = true WHERE id_traslado = v_envio;
        UPDATE traslado_productos SET cantidad_recibida = cantidad WHERE id_traslado = v_envio;
        IF random() < 0.15 THEN
          UPDATE traslado_tachos SET recibido = false, motivo_faltante = 'No vino en la camioneta (dato de demostración)'
           WHERE id_traslado_tacho = (SELECT min(id_traslado_tacho) FROM traslado_tachos WHERE id_traslado = v_envio);
        END IF;
        IF random() < 0.15 THEN
          UPDATE traslado_productos SET cantidad_recibida = cantidad - 1, motivo_faltante = 'Llegó uno roto (dato de demostración)'
           WHERE id_traslado_producto = (SELECT min(id_traslado_producto) FROM traslado_productos WHERE id_traslado = v_envio);
        END IF;
        UPDATE traslados SET estado = 'RECIBIDO', fecha_recepcion = v_hora + interval '50 minutes', id_usuario_recepcion = v_usuario
         WHERE id_traslado = v_envio;
      END IF;  -- el del ultimo dia queda en camino
    END IF;

    -- Ventas mayoristas: un par por semana por cliente, casi siempre familiar.
    IF random() < 0.5 THEN
      SELECT id_cliente INTO v_cli FROM clientes WHERE tipo_cliente = 'MAYORISTA' AND nombre_razon_social LIKE 'Demo · %' ORDER BY random() LIMIT 1;
      v_linea := CASE WHEN random() < 0.85 THEN 'FAMILIAR' ELSE 'ARTESANAL' END;
      v_envase := CASE WHEN random() < 0.6 THEN 'RETORNABLE' ELSE 'INCLUIDO' END;
      SELECT precio INTO v_precio FROM precios_mayoristas WHERE linea = v_linea AND envase = v_envase AND fecha_vigencia_hasta IS NULL;
      v_n := 2 + floor(random() * 5);
      IF v_precio IS NOT NULL AND (SELECT count(*) FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote JOIN sabores s ON s.id_sabor = l.id_sabor
                                    WHERE t.id_sucursal = v_fab AND t.estado = 'LLENO' AND s.linea = v_linea
                                      AND l.codigo_lote LIKE 'DEMO-L%' AND l.fecha_elaboracion <= v_dia) >= v_n THEN
        v_hora := v_dia + time '11:00' + random() * interval '5 hours';
        INSERT INTO ventas (id_usuario, id_cliente, canal_venta, tipo_venta, id_sucursal, fecha_hora)
        VALUES (v_usuario, v_cli, 'MAYORISTA', 'MAYORISTA', v_fab, v_hora) RETURNING id_venta INTO v_venta;
        FOR v_t IN
          SELECT t.id_tacho FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote JOIN sabores s ON s.id_sabor = l.id_sabor
           WHERE t.id_sucursal = v_fab AND t.estado = 'LLENO' AND s.linea = v_linea
             AND l.codigo_lote LIKE 'DEMO-L%' AND l.fecha_elaboracion <= v_dia
           ORDER BY l.fecha_vencimiento, random() LIMIT v_n
        LOOP
          INSERT INTO venta_tachos (id_venta, id_tacho, envase, precio_aplicado) VALUES (v_venta, v_t.id_tacho, v_envase, v_precio);
        END LOOP;
        v_total := v_n * v_precio;
        -- La mitad paga en el momento, algunos dejan una parte y otros
        -- quedan debiendo, para que se vea la cuenta corriente.
        v_r := random();
        v_medio := CASE WHEN random() < 0.6 THEN m_transf ELSE m_efectivo END;
        IF v_r < 0.5 THEN
          INSERT INTO pagos_venta (id_venta, id_medio_pago, id_usuario, monto, fecha_hora) VALUES (v_venta, v_medio, v_usuario, v_total, v_hora);
        ELSIF v_r < 0.75 THEN
          INSERT INTO pagos_venta (id_venta, id_medio_pago, id_usuario, monto, fecha_hora)
          VALUES (v_venta, v_medio, v_usuario, round((v_total * (0.3 + random() * 0.4))::numeric, -3), least(now(), v_hora + interval '6 days'));
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- El helado fabricado hace mas de dos semanas que no se envio ni se vendio
  -- en su mayoria ya se uso en el mostrador.
  UPDATE tachos t SET estado = 'VACIO'
    FROM lotes l
   WHERE l.id_lote = t.id_lote AND l.codigo_lote LIKE 'DEMO-L%' AND t.estado = 'LLENO'
     AND l.fecha_elaboracion < current_date - 14 AND random() < 0.7;

  -- Devoluciones de envases: cada cliente ya devolvio mas o menos la mitad
  -- de los retornables que se llevo.
  INSERT INTO devoluciones_envases (id_cliente, cantidad, id_usuario, fecha_hora, observaciones)
  SELECT v.id_cliente, floor(count(*) * 0.55), v_usuario, now() - interval '2 days', 'Dato de demostración'
    FROM ventas v JOIN venta_tachos vt ON vt.id_venta = v.id_venta
   WHERE v.id_usuario = v_usuario AND vt.envase = 'RETORNABLE'
   GROUP BY v.id_cliente HAVING floor(count(*) * 0.55) > 0;

  -- Ingresos de mercaderia: una vez por semana, de alguno de los
  -- proveedores, llega el 30% de lo que gasto la fabricacion en el mes (en
  -- las cuatro semanas, un 20% mas de lo que se gasto).
  FOR v_semana IN 0..3 LOOP
    SELECT id_proveedor INTO v_proveedor FROM proveedores WHERE activo ORDER BY random() LIMIT 1;
    INSERT INTO ingresos_mercaderia (id_sucursal, id_proveedor, numero_remito, observaciones, id_usuario, fecha_hora)
    VALUES (v_fab, v_proveedor, '0001-' || lpad((4500 + floor(random() * 500))::text, 8, '0'), 'Dato de demostración', v_usuario,
            current_date - ${DIAS_OPERACION} + v_semana * 7 + time '09:30')
    RETURNING id_ingreso INTO v_ingreso;
    INSERT INTO movimientos_insumo (id_insumo, id_sucursal, tipo_movimiento, cantidad, id_usuario, id_ingreso, fecha_hora)
    SELECT m.id_insumo, v_fab, 'ENTRADA_COMPRA',
           CASE WHEN u.magnitud = 'CONTEO' THEN ceil(-sum(m.cantidad) * 0.3) ELSE ceil(-sum(m.cantidad) * 0.3 * 10) / 10 END,
           v_usuario, v_ingreso, current_date - ${DIAS_OPERACION} + v_semana * 7 + time '09:30'
      FROM movimientos_insumo m JOIN insumos i ON i.id_insumo = m.id_insumo JOIN unidades_medida u ON u.id_unidad = i.id_unidad_medida
     WHERE m.id_usuario = v_usuario AND m.tipo_movimiento = 'CONSUMO_PRODUCCION'
     GROUP BY m.id_insumo, u.magnitud;
  END LOOP;

  -- Y en cada sucursal, una vez, la reposteria y las salsas que se compran hechas.
  FOR v_t IN SELECT id_sucursal FROM sucursales WHERE activa LOOP
    SELECT id_proveedor INTO v_proveedor FROM proveedores WHERE activo ORDER BY random() LIMIT 1;
    INSERT INTO ingresos_mercaderia (id_sucursal, id_proveedor, numero_remito, observaciones, id_usuario, fecha_hora)
    VALUES (v_t.id_sucursal, v_proveedor, '0002-' || lpad((1200 + floor(random() * 300))::text, 8, '0'), 'Dato de demostración', v_usuario,
            current_date - 5 + time '10:00')
    RETURNING id_ingreso INTO v_ingreso;
    INSERT INTO movimientos_producto (id_producto, id_sucursal, tipo_movimiento, cantidad, id_usuario, id_ingreso, fecha_hora)
    SELECT p.id_producto, v_t.id_sucursal, 'ENTRADA_COMPRA', 6 + floor(random() * 19), v_usuario, v_ingreso, current_date - 5 + time '10:00'
      FROM productos p WHERE p.activo AND p.lleva_stock_propio AND p.tipo_origen = 'COMPRADO_TERMINADO';
  END LOOP;
END $$;
`;

const SQL_BORRAR = `
CREATE TEMP TABLE demo_u ON COMMIT DROP AS SELECT id_usuario, id_empleado, created_at AS marca FROM usuarios WHERE username = '${USUARIO}';
CREATE TEMP TABLE demo_v ON COMMIT DROP AS SELECT id_venta FROM ventas WHERE id_usuario IN (SELECT id_usuario FROM demo_u);
CREATE TEMP TABLE demo_c ON COMMIT DROP AS SELECT id_caja FROM cajas WHERE id_usuario_apertura IN (SELECT id_usuario FROM demo_u);
CREATE TEMP TABLE demo_t ON COMMIT DROP AS SELECT id_traslado FROM traslados WHERE id_usuario IN (SELECT id_usuario FROM demo_u);
CREATE TEMP TABLE demo_p ON COMMIT DROP AS SELECT id_produccion FROM produccion WHERE id_usuario_responsable IN (SELECT id_usuario FROM demo_u);
CREATE TEMP TABLE demo_i ON COMMIT DROP AS SELECT id_ingreso FROM ingresos_mercaderia WHERE id_usuario IN (SELECT id_usuario FROM demo_u);
DELETE FROM movimientos_producto WHERE id_usuario IN (SELECT id_usuario FROM demo_u) OR id_venta IN (SELECT id_venta FROM demo_v)
   OR id_traslado IN (SELECT id_traslado FROM demo_t) OR id_produccion IN (SELECT id_produccion FROM demo_p) OR id_ingreso IN (SELECT id_ingreso FROM demo_i);
DELETE FROM movimientos_insumo WHERE id_usuario IN (SELECT id_usuario FROM demo_u) OR id_venta IN (SELECT id_venta FROM demo_v)
   OR id_produccion IN (SELECT id_produccion FROM demo_p) OR id_ingreso IN (SELECT id_ingreso FROM demo_i);
DELETE FROM devoluciones_envases WHERE id_usuario IN (SELECT id_usuario FROM demo_u);
DELETE FROM pagos_venta WHERE id_venta IN (SELECT id_venta FROM demo_v);
DELETE FROM venta_detalle WHERE id_venta IN (SELECT id_venta FROM demo_v);
DELETE FROM venta_tachos WHERE id_venta IN (SELECT id_venta FROM demo_v);
DELETE FROM ventas WHERE id_venta IN (SELECT id_venta FROM demo_v);
DELETE FROM traslado_tachos WHERE id_traslado IN (SELECT id_traslado FROM demo_t);
DELETE FROM traslado_productos WHERE id_traslado IN (SELECT id_traslado FROM demo_t);
DELETE FROM traslados WHERE id_traslado IN (SELECT id_traslado FROM demo_t);
DELETE FROM egresos WHERE id_caja IN (SELECT id_caja FROM demo_c);
DELETE FROM cajas WHERE id_caja IN (SELECT id_caja FROM demo_c);
DELETE FROM tachos WHERE id_lote IN (SELECT id_lote FROM lotes WHERE codigo_lote LIKE 'DEMO-%');
DELETE FROM lotes WHERE codigo_lote LIKE 'DEMO-%';
DELETE FROM produccion WHERE id_produccion IN (SELECT id_produccion FROM demo_p);
DELETE FROM ingresos_mercaderia WHERE id_ingreso IN (SELECT id_ingreso FROM demo_i);
DELETE FROM receta_detalle WHERE created_at = (SELECT marca FROM demo_u);
DELETE FROM recetas WHERE created_at = (SELECT marca FROM demo_u);
DELETE FROM producto_insumos WHERE created_at = (SELECT marca FROM demo_u);
DELETE FROM costos_producto WHERE created_at = (SELECT marca FROM demo_u);
DELETE FROM costos_insumo WHERE created_at = (SELECT marca FROM demo_u);
DELETE FROM precios_mayoristas WHERE id_usuario IN (SELECT id_usuario FROM demo_u);
DELETE FROM clientes WHERE created_at = (SELECT marca FROM demo_u) AND nombre_razon_social LIKE 'Demo · %';
DELETE FROM usuarios WHERE id_usuario IN (SELECT id_usuario FROM demo_u);
DELETE FROM empleados WHERE id_empleado IN (SELECT id_empleado FROM demo_u);
`;

// Apaga o prende los triggers propios de cada tabla (no las claves foraneas,
// que siguen controlando). Se hace tabla por tabla y no con
// session_replication_role porque eso pide ser superusuario, y en la nube
// (Render) nadie lo es; ALTER TABLE solo pide ser el dueno de la tabla, y el
// dueno es el usuario que corrio las migraciones. Va dentro de la
// transaccion: si algo falla, los triggers quedan como estaban.
async function apagarTriggers(c, apagar) {
  const { rows } = await c.query(
    `SELECT DISTINCT format('%I.%I', n.nspname, cl.relname) AS tabla
       FROM pg_trigger t
       JOIN pg_class cl ON cl.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public'`
  );
  for (const { tabla } of rows) {
    await c.query('ALTER TABLE ' + tabla + (apagar ? ' DISABLE' : ' ENABLE') + ' TRIGGER USER');
  }
}

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
    await apagarTriggers(c, true);
    await c.query(accion === 'cargar' ? SQL_CARGAR : SQL_BORRAR);
    await apagarTriggers(c, false);
    if (accion === 'cargar') await c.query(SQL_OPERAR);
    await c.query('COMMIT');
    if (accion === 'cargar') {
      const { rows: [r] } = await c.query(
        `WITH u AS (SELECT id_usuario, created_at FROM usuarios WHERE username = $1)
         SELECT (SELECT count(*) FROM ventas WHERE tipo_venta = 'MINORISTA' AND id_usuario IN (SELECT id_usuario FROM u))::int AS ventas,
                (SELECT count(*) FROM ventas WHERE tipo_venta = 'MAYORISTA' AND id_usuario IN (SELECT id_usuario FROM u))::int AS mayoristas,
                (SELECT count(*) FROM cajas WHERE id_usuario_apertura IN (SELECT id_usuario FROM u))::int AS cajas,
                (SELECT count(*) FROM egresos WHERE id_usuario IN (SELECT id_usuario FROM u))::int AS egresos,
                (SELECT count(*) FROM tachos t JOIN lotes l ON l.id_lote = t.id_lote WHERE l.codigo_lote LIKE 'DEMO-%')::int AS tachos,
                (SELECT count(*) FROM produccion WHERE id_usuario_responsable IN (SELECT id_usuario FROM u))::int AS producciones,
                (SELECT count(*) FROM traslados WHERE id_usuario IN (SELECT id_usuario FROM u))::int AS envios,
                (SELECT count(*) FROM ingresos_mercaderia WHERE id_usuario IN (SELECT id_usuario FROM u))::int AS ingresos,
                (SELECT count(*) FROM recetas WHERE created_at = (SELECT created_at FROM u))::int AS recetas,
                (SELECT count(*) FROM costos_producto WHERE created_at = (SELECT created_at FROM u))::int AS costos,
                (SELECT count(*) FROM costos_insumo WHERE created_at = (SELECT created_at FROM u))::int AS costos_insumo,
                (SELECT count(*) FROM clientes WHERE created_at = (SELECT created_at FROM u))::int AS clientes`,
        [USUARIO]
      );
      console.log('Datos de demostración cargados:');
      console.log('  ' + r.ventas + ' ventas de mostrador en ' + r.cajas + ' turnos de caja, con ' + r.egresos + ' egresos');
      console.log('  ' + r.clientes + ' clientes mayoristas y ' + r.mayoristas + ' ventas mayoristas');
      console.log('  ' + r.producciones + ' fabricaciones, ' + r.envios + ' envíos, ' + r.ingresos + ' ingresos de mercadería y ' + r.tachos + ' tachos');
      console.log('  ' + r.recetas + ' recetas, ' + r.costos + ' costos de producto y ' + r.costos_insumo + ' costos de insumo');
      console.log('Para sacarlos: npm run demo:borrar');
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
