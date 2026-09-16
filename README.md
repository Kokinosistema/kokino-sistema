# Kokino Sistema

Sistema de gestión propio para la heladería Kokino (San Miguel de Tucumán,
Argentina), pensado para reemplazar el POS actual (Fudo). Es el Trabajo de
Campo de la carrera.

## Estructura del negocio

Kokino cuenta con **una fábrica y dos sucursales de venta**:

- **Fábrica**: ubicada en el mismo edificio que la Sucursal 1 (arriba del
  local), es donde se produce el helado. Desde ahí se reparte a la
  Sucursal 2.
- **Sucursal 1**: local de venta, comparte edificio con la fábrica.
- **Sucursal 2**: local de venta, solo vende (no produce).

Cada sucursal tiene su propia caja, su propio stock y sus propias ventas —
no comparten nada operativo entre sí.

## Alcance del sistema

- Producción de helado por lotes (fórmulas, ingredientes, tachos).
- Ventas minoristas (por peso y por unidad) y mayoristas.
- Stock independiente por sucursal.
- Caja diaria por sucursal (ventas y egresos).
- Cuenta corriente de clientes mayoristas y proveedores.
- Preparación para facturación electrónica AFIP (a integrar más adelante).

Fuera de alcance: contabilidad completa, RRHH/liquidación de sueldos,
e-commerce.

## Base de datos

- Motor: PostgreSQL 17.
- Migraciones: [node-pg-migrate](https://github.com/salsita/node-pg-migrate)
  (SQL plano, sin ORM).
- Base de desarrollo: `kokino_dev`.

## Requisitos

- Node.js 24 LTS
- PostgreSQL 17

## Configuración local

1. Copiar `.env.example` a `.env` y completar los valores reales
   (nunca se sube `.env` al repositorio).
2. Instalar dependencias: `npm install`.
