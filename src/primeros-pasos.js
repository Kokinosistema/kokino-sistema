'use strict';

// Guia de "Primeros pasos" para los duenos (punto 14 de las mejoras,
// 2026-10-07): lo que falta cargar para dejar el sistema listo. Cada paso se
// tilda solo, mirando la base, y lleva a la pantalla donde se hace. Cuando
// estan todos, la guia no se muestra.

const { consultar } = require('./db');
const { avisoDeCopias, ultimaCopiaBuena } = require('./copias');

async function primerosPasos() {
  const { rows: [r] } = await consultar(`
    SELECT
      (SELECT count(*) FROM usuarios u JOIN roles ro ON ro.id_rol = u.id_rol
        WHERE u.activo AND ro.nombre_rol = 'empleado')::int AS empleados,
      (SELECT count(*) FROM sucursales WHERE activa)::int AS sucursales,
      (SELECT count(*) FROM sucursales WHERE activa AND punto_venta_afip IS NULL)::int AS sin_punto_venta,
      (SELECT count(*) FROM sucursales s WHERE s.activa
          AND NOT EXISTS (SELECT 1 FROM tachos t WHERE t.id_sucursal = s.id_sucursal))::int AS sin_helado,
      (SELECT count(*) FROM sucursales s WHERE s.activa
          AND NOT EXISTS (SELECT 1 FROM movimientos_producto m WHERE m.id_sucursal = s.id_sucursal AND m.tipo_movimiento IN ('STOCK_INICIAL', 'RECUENTO'))
          AND NOT EXISTS (SELECT 1 FROM movimientos_insumo m WHERE m.id_sucursal = s.id_sucursal AND m.tipo_movimiento IN ('STOCK_INICIAL', 'RECUENTO')))::int AS sin_stock,
      (SELECT count(*) FROM precios_mayoristas WHERE fecha_vigencia_hasta IS NULL)::int AS precios_mayoristas,
      (SELECT count(*) FROM productos p WHERE p.activo AND p.tipo_origen = 'COMPRADO_TERMINADO'
          AND NOT EXISTS (SELECT 1 FROM costos_producto c WHERE c.id_producto = p.id_producto AND c.fecha_vigencia_hasta IS NULL))::int AS productos_sin_costo,
      (SELECT count(*) FROM insumos i WHERE i.activo
          AND NOT EXISTS (SELECT 1 FROM costos_insumo c WHERE c.id_insumo = i.id_insumo AND c.fecha_vigencia_hasta IS NULL))::int AS insumos_sin_costo,
      (SELECT count(*) FROM productos p WHERE p.activo AND NOT p.lleva_stock_propio
          AND NOT EXISTS (SELECT 1 FROM producto_insumos pi WHERE pi.id_producto = p.id_producto))::int AS armados_sin_insumos,
      (SELECT count(*) FROM sabores s WHERE s.activo
          AND NOT EXISTS (SELECT 1 FROM recetas r WHERE r.id_sabor_resultado = s.id_sabor AND r.fecha_vigencia_hasta IS NULL))::int AS sabores_sin_receta,
      (SELECT count(*) FROM proveedores WHERE activo)::int AS proveedores,
      (SELECT count(*) FROM clientes WHERE activo AND tipo_cliente = 'MAYORISTA')::int AS clientes
  `);
  const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
  const pasos = [
    { titulo: 'Cuentas de los empleados', listo: r.empleados > 0, enlace: '/usuarios',
      detalle: r.empleados > 0 ? plural(r.empleados, 'cuenta de empleado', 'cuentas de empleados') : 'Cada empleado entra con su usuario: así queda registrado quién vendió y quién abrió la caja.' },
    { titulo: 'Tachos de helado que ya hay en los freezers', listo: r.sin_helado === 0, enlace: '/stock/helado',
      detalle: r.sin_helado === 0 ? 'Cargados en todas las sucursales' : 'Falta en ' + plural(r.sin_helado, 'sucursal', 'sucursales') + '. Elegí la sucursal arriba y cargalos desde Fabricación.' },
    { titulo: 'Stock de productos e insumos', listo: r.sin_stock === 0, enlace: '/productos?cargar=1',
      detalle: r.sin_stock === 0 ? 'Cargado en todas las sucursales' : 'Falta en ' + plural(r.sin_stock, 'sucursal', 'sucursales') + '. En Productos e Insumos, botón Cargar stock.' },
    { titulo: 'Qué lleva cada producto', listo: r.armados_sin_insumos === 0, enlace: '/productos',
      detalle: r.armados_sin_insumos === 0 ? 'Todos los productos que se arman al vender tienen sus insumos' : plural(r.armados_sin_insumos, 'producto', 'productos') + ' que se arman al vender (cucuruchos, térmicos, cafés) sin decir qué insumos usan: venderlos no descuenta nada.' },
    { titulo: 'Costos', listo: r.productos_sin_costo === 0 && r.insumos_sin_costo === 0, enlace: '/costos',
      detalle: r.productos_sin_costo === 0 && r.insumos_sin_costo === 0 ? 'Todos cargados' : 'Faltan ' + [r.productos_sin_costo ? plural(r.productos_sin_costo, 'producto', 'productos') : null, r.insumos_sin_costo ? plural(r.insumos_sin_costo, 'insumo', 'insumos') : null].filter(Boolean).join(' y ') + '. Con los costos se calcula el margen.' },
    { titulo: 'Recetas de los sabores', listo: r.sabores_sin_receta === 0, enlace: '/recetas',
      detalle: r.sabores_sin_receta === 0 ? 'Todos los sabores tienen receta' : plural(r.sabores_sin_receta, 'sabor', 'sabores') + ' sin receta: producirlos no descuenta insumos.' },
    { titulo: 'Precios mayoristas', listo: r.precios_mayoristas > 0, enlace: '/clientes/precios',
      detalle: r.precios_mayoristas > 0 ? 'Cargados' : 'El precio sugerido del tacho para mayoristas, por línea y envase.' },
    { titulo: 'Clientes mayoristas', listo: r.clientes > 0, enlace: '/clientes',
      detalle: r.clientes > 0 ? plural(r.clientes, 'cliente', 'clientes') : 'Para venderles tachos y llevar su cuenta.' },
    { titulo: 'Proveedores', listo: r.proveedores > 0, enlace: '/proveedores',
      detalle: r.proveedores > 0 ? plural(r.proveedores, 'proveedor', 'proveedores') : 'Para anotar de quién viene la mercadería.' },
    { titulo: 'Punto de venta de AFIP de cada sucursal', listo: r.sin_punto_venta === 0, enlace: '/sucursales',
      detalle: r.sin_punto_venta === 0 ? 'Cargados' : 'Falta en ' + plural(r.sin_punto_venta, 'sucursal', 'sucursales') + '. Se da de alta en la web de AFIP; hace falta para facturar.' },
    { titulo: 'Copia de seguridad diaria', listo: avisoDeCopias() === null, enlace: null,
      detalle: avisoDeCopias() === null
        ? 'Última copia: ' + ultimaCopiaBuena().toLocaleString('es-AR', { hour12: false }) + '. Tiene que correr sola todos los días: si pasan dos días sin copia, este paso se destilda.'
        : 'Programarla en la computadora donde quede instalado el sistema (ver docs/INSTALACION.md).' },
  ];
  return { pasos, listos: pasos.filter((p) => p.listo).length };
}

module.exports = { primerosPasos };
