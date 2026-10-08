# Instalar y mantener Kokino

Cómo dejar el sistema funcionando para usarlo de verdad en la heladería: que
arranque solo, que se recupere si se cae y que haga una copia de seguridad
por día. Sirve para una PC con Windows o para un servidor con Linux.

Para trabajar en el código (modo desarrollo), ver el [README](../README.md).

---

## 1. Lo que hace falta

- **Node.js 24** o más nuevo.
- **PostgreSQL 17** (o 16), con una base creada para Kokino.
- **Git**, para bajar el código y las actualizaciones.
- Para usarlo desde las dos sucursales: que la computadora o el servidor
  sea accesible por internet, idealmente con una dirección **HTTPS**.

## 2. Instalar

```bash
git clone <dirección del repositorio> kokino-sistema
cd kokino-sistema
npm install
```

Copiar `.env.example` como `.env` y completarlo:

| Variable | Para qué | Ejemplo |
|---|---|---|
| `DATABASE_URL` | Conexión a la base | `postgres://kokino:CLAVE@localhost:5432/kokino` |
| `SESSION_SECRET` | Firma de las sesiones. Una propia por instalación | (generar con el comando del `.env.example`) |
| `PORT` | Puerto (opcional, por defecto 3000) | `3000` |
| `NODE_ENV` | Poner `produccion` **solo si se entra por HTTPS** (si no, no deja iniciar sesión) | `produccion` |
| `ZONA_HORARIA` | Opcional. Por defecto, hora de Tucumán aunque el servidor esté en otro país | `America/Argentina/Tucuman` |
| `CARPETA_COPIAS` | Dónde se guardan las copias de seguridad (ver punto 5) | `C:\Users\Kokino\Google Drive\copias-kokino` |
| `DIAS_COPIAS` | Cuántos días se guardan (por defecto 30) | `30` |
| `PG_BIN` | Carpeta de los programas de PostgreSQL, si `pg_dump` no se encuentra solo | `C:\Program Files\PostgreSQL\17\bin` |

Crear las tablas y el primer usuario (dueño):

```bash
npm run migrate:up
npm run crear-usuario
```

> No correr `npm run seed:precios` sobre una base en uso: vuelve los precios a
> los de la lista original y pisa los que cargaron los dueños.

## 3. Dejarlo corriendo (PM2)

En la heladería no se usa `npm run dev` (es para programar: se reinicia con
cada cambio de archivo). Se usa **PM2**, que lo reinicia solo si se cae y lo
arranca con la computadora. La configuración está en `ecosystem.config.js`.

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

Comandos útiles:

```bash
pm2 status            # ¿está andando?
pm2 logs kokino       # ver lo que va pasando (también en la carpeta logs/)
pm2 restart kokino    # reiniciar (por ejemplo, después de actualizar)
pm2 stop kokino       # apagarlo
```

### Que arranque solo al prender la computadora

- **Linux:** `pm2 startup` y seguir la instrucción que muestra; después `pm2 save`.
- **Windows:** instalar el servicio con [pm2-installer](https://github.com/jessety/pm2-installer)
  (seguir su README, como administrador). Después, `pm2 start ecosystem.config.js`
  y `pm2 save`.

Para saber desde afuera si está andando: `http://<servidor>:3000/salud`
responde `ok` si el sistema y la base contestan.

## 4. Actualizar a una versión nueva

```bash
npm run copia          # primero, una copia de seguridad
git pull
npm install
npm run migrate:up     # aplica los cambios de la base, si hay
pm2 restart kokino
```

Las sesiones se guardan en la base, así que reiniciar no desloguea a nadie ni
pierde los pedidos que se estaban armando.

## 5. Copias de seguridad

`npm run copia` guarda un archivo con toda la base en `CARPETA_COPIAS` (por
defecto, `copias-kokino` al lado del proyecto), borra las de más de
`DIAS_COPIAS` días y anota cómo salió. El **Inicio de los dueños** muestra un
aviso si la última copia falló o tiene más de dos días.

> Si `CARPETA_COPIAS` es la carpeta de **Google Drive** u **OneDrive** de la
> computadora, las copias quedan también en la nube: si se rompe el disco, no
> se pierde nada.

### Programar la copia diaria

**Windows** (en una consola, una sola vez; corre todos los días a las 3:00):

```powershell
schtasks /Create /SC DAILY /ST 03:00 /TN "Kokino - copia de seguridad" /TR "cmd /c cd /d C:\ruta\a\kokino-sistema && npm run copia >> logs\copias.log 2>&1"
```

Para probar que anda: `schtasks /Run /TN "Kokino - copia de seguridad"` y
mirar que aparezca el archivo nuevo en la carpeta de copias.

**Linux** (`crontab -e` y agregar la línea):

```
0 3 * * * cd /ruta/a/kokino-sistema && npm run copia >> logs/copias.log 2>&1
```

### Restaurar una copia

Para volver a una copia (por ejemplo, después de un desastre). **Reemplaza
todo lo que hay en la base** por lo de la copia:

```bash
pm2 stop kokino
pg_restore --clean --if-exists --no-owner -d "<DATABASE_URL>" copias-kokino/kokino-AAAA-MM-DD_HHMMSS.dump
pm2 start kokino
```

Para mirar una copia sin tocar la base real, restaurarla en una base aparte:

```bash
createdb kokino_revision
pg_restore --no-owner -d kokino_revision copias-kokino/kokino-AAAA-MM-DD_HHMMSS.dump
```

## 6. Si algo no anda

- **No entra nadie / da error al iniciar sesión:** si no hay HTTPS, sacar
  `NODE_ENV=produccion` del `.env` y `pm2 restart kokino`.
- **"An Application Control policy has blocked this file" (Windows):** el
  Control inteligente de aplicaciones bloquea PostgreSQL; desactivarlo en
  Seguridad de Windows.
- **La hora de las ventas está corrida:** revisar `ZONA_HORARIA` (por defecto
  ya es la de Tucumán).
- **Ver qué pasó:** `pm2 logs kokino` o la carpeta `logs/`.
