# Kokino Sistema

Sistema de gestión propio para la heladería Kokino (San Miguel de Tucumán,
Argentina), pensado para reemplazar el POS actual (Fudo). Es el Trabajo de
Campo de la carrera.

## Estructura del negocio

Kokino cuenta con **una fábrica y dos sucursales de venta**:

- **Fábrica**: ubicada en el mismo edificio que la sucursal Entre Ríos (arriba
  del local), es donde se produce el helado. Desde ahí se reparte a Alem.
- **Entre Ríos** (Entre Ríos 604): local de venta, comparte edificio con la
  fábrica.
- **Alem** (Av. Alem y Lavalle): local de venta, solo vende (no produce).

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

Todas las computadoras donde se trabaje el proyecto tienen que usar la misma
versión de PostgreSQL. Si una usa la 17 y otra la 18, algo puede funcionar en
una y fallar en la otra sin motivo aparente, y el error se termina buscando en
el lugar equivocado. Cambiar de versión no cuesta nada: se desinstala, se
instala la que corresponde y se corre `npm run migrate:up`, porque la base se
reconstruye entera desde las migraciones.

## Configuración local

1. Instalar dependencias: `npm install`.
2. Copiar `.env.example` a `.env` y completar la contraseña real de PostgreSQL.
   El `.env` no se sube al repositorio, así que cada máquina tiene el suyo: la
   contraseña de la base es propia del equipo donde se trabaja, no del proyecto.
3. Crear la base vacía `kokino_dev`, desde pgAdmin o por consola. En Windows,
   las herramientas de PostgreSQL no suelen quedar en el PATH, así que hay que
   llamarlas por su ruta completa:

   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -U postgres kokino_dev
   ```
4. Construir el esquema y cargar los datos base: `npm run migrate:up`.
   Las migraciones corren en orden y dejan la base lista desde cero, así que no
   hace falta pasarse un backup entre computadoras.
5. Cargar los precios vigentes: `npm run seed:precios` y
   `npm run seed:precios-mayoristas`.

## Usarlo en la heladería

Para dejarlo instalado de verdad (que arranque solo, que se recupere si se cae
y que haga una copia de seguridad por día), ver
[docs/INSTALACION.md](docs/INSTALACION.md).

## Migraciones y seeds

Son dos cosas distintas y conviene no mezclarlas:

- **Migraciones** (`migrations/`): cambian la estructura de la base y los datos
  que el sistema necesita para existir (sucursales, categorías, sabores). Se
  corren una sola vez y en orden; su historial no se reescribe. Cada una tiene
  su `up` y su `down` para poder revertirla.
- **Seeds** (`seeds/`): ponen la base en un estado conocido y se pueden correr
  las veces que haga falta. Acá van los datos que cambian seguido, como los
  precios: un aumento no debería agregar un archivo al historial del esquema.

Comandos útiles:

```bash
npm run migrate:up                  # aplica las migraciones pendientes
npm run migrate:down                # revierte la última
npm run migrate:create nombre-corto # crea una migración nueva
npm run seed:precios                # actualiza los precios de lista
npm run seed:precios-mayoristas     # actualiza los precios mayoristas por sabor
```

## Pruebas automáticas

```bash
npm test
```

Prueban el sistema como lo usa una persona: entran con un usuario, completan
formularios y revisan lo que responde (avisos, errores, montos). Cubren caja,
ventas y anulaciones, PedidosYa, venta mayorista (precios, cuenta corriente,
envases), fabricación, envíos entre sucursales, ingreso de mercadería, el
historial de ventas, las alertas de stock y los permisos de cada rol.

Corren contra una base aparte, `kokino_prueba`, que **se borra y se arma de
nuevo en cada corrida** (migraciones, seeds y usuarios de prueba). Así cada
corrida arranca del mismo punto. Por defecto es la misma conexión del `.env`
con otro nombre de base; se puede cambiar con `DATABASE_URL_PRUEBA`. Como
seguro, las pruebas se niegan a correr si el nombre de la base no termina en
`_prueba`: nunca pueden borrar `kokino_dev` ni la base de la heladería.

Conviene correrlas antes de cada commit. Si una falla, el cambio rompió algo
que antes andaba.
