# Publicar Kokino en Vercel con Supabase

Kokino corre en **Vercel**, que atiende las visitas, y guarda los datos en
**Supabase**, que es la base PostgreSQL. Para usarlo en una PC del local, sin
nube, sigue valiendo [INSTALACION.md](INSTALACION.md).

## Qué cambia respecto de una PC

- **No hay servidor siempre prendido.** Vercel prende el sistema cuando llega
  una visita (punto de entrada `api/index.js`, configurado en `vercel.json`).
  `server.js` se sigue usando solo en la compu.
- **Las migraciones corren solas** antes de cada publicación de producción
  (`scripts/migrar-en-vercel.js`). Las publicaciones de prueba (una por rama)
  no tocan la base.
- **Las copias de seguridad las hace Supabase.** Por eso el Inicio no avisa de
  copias en Vercel.
- **El límite de intentos de login se guarda en la base** (tabla
  `intentos_login`), porque en Vercel corren varias copias del sistema a la vez.

## Planes

Precios a confirmar en las páginas de Vercel y Supabase:

- **Vercel:** el plan gratuito (Hobby) es solo para uso personal, no comercial.
  Para la heladería corresponde el plan **Pro**, de unos USD 20 por mes.
- **Supabase:** el plan gratuito **pausa la base después de una semana sin uso
  y no hace copias de seguridad**. Para datos reales corresponde el plan
  **Pro**, de unos USD 25 por mes, con copias diarias.

## 1. Crear la base en Supabase

1. Crear un proyecto nuevo en <https://supabase.com>, en la región
   **South America (São Paulo)**, la más cercana. Anotar la contraseña de la
   base.
2. En **Project Settings → Database → SSL Configuration**, descargar el
   certificado y guardarlo en el repositorio como
   `certificados/supabase-ca.crt`. Es público: se puede subir a GitHub.
3. En el botón **Connect** del proyecto, copiar dos conexiones:
   - **Transaction pooler** (puerto `6543`): es la que usa el sistema.
   - **Session pooler** (puerto `5432`): es la de las migraciones y los
     scripts.

   A las dos se les agrega al final:
   `?sslmode=verify-full&sslrootcert=certificados/supabase-ca.crt`

## 2. Crear el proyecto en Vercel

1. En <https://vercel.com>, **Add New → Project** e importar el repositorio de
   GitHub `kokino-sistema`. Dejar *Framework Preset: Other* y no tocar los
   comandos de build.
2. En **Settings → Environment Variables**, cargar estas variables para
   *Production*:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | la conexión *Transaction pooler* (puerto 6543) |
   | `DATABASE_URL_MIGRACIONES` | la conexión *Session pooler* (puerto 5432) |
   | `SESSION_SECRET` | una clave nueva: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

3. Publicar (**Deploy**). Antes de publicar, Vercel arma la base desde cero
   con las migraciones.
4. Comprobar que `https://<proyecto>.vercel.app/salud` diga `ok`.

## 3. Cargar los datos iniciales (una sola vez)

Desde la compu, con la conexión *Session pooler* en lugar de `DATABASE_URL`
del `.env`, o pasándola en el comando:

```
DATABASE_URL="<session pooler>" npm run seed:precios
DATABASE_URL="<session pooler>" npm run seed:precios-mayoristas
DATABASE_URL="<session pooler>" npm run crear-usuario
```

> No volver a correr los seeds cuando ya se esté usando: pisan los precios que
> cargaron los dueños.

## 4. Dominio propio (opcional)

En Vercel, **Settings → Domains**, agregar por ejemplo
`sistema.kokino.com.ar` y crear en el DNS el registro que indique Vercel.

## Si algo falla

- **"Falta DATABASE_URL…" o "Falta SESSION_SECRET…"** en los registros de
  Vercel: falta cargar esa variable (paso 2.2).
- **Errores de certificado** (`self-signed certificate`): falta el archivo
  `certificados/supabase-ca.crt`, o la conexión no termina en
  `sslrootcert=certificados/supabase-ca.crt`.
- **La publicación falla en "vercel-build"**: falló una migración. El detalle
  está en el registro de la publicación; la base queda como estaba.
