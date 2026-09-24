# Variables de entorno

> Actualizado en la etapa 1 (Paso 2). Confianza: **[Verificado]** (`lib/env/schema.ts`, `next.config.ts`, `lib/env/schema.test.ts`).

## Variables

| Variable | Visibilidad | Descripción |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Pública** (se incrusta en el bundle del navegador) | URL del proyecto Supabase. En local: `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Pública** | Clave `anon` (JWT). No es secreta por diseño: la seguridad depende de RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **Solo servidor** | Clave `service_role`. **Salta RLS.** Invita usuarios (`auth.admin`), despacha el outbox de alertas y, en el cron, llama a RPCs de `service_role` |
| `APP_URL` | Solo servidor | URL pública de la app; base de los enlaces de invitación y de restablecer contraseña |
| `CRON_SECRET` | Solo servidor, **opcional** | Bearer de `GET /api/cron/tick` (cierra jornadas de más de 24 h). Si falta, la ruta responde 503. Vercel Cron envía `Authorization: Bearer $CRON_SECRET` |
| `R2_ACCOUNT_ID` | Solo servidor | Cuenta de Cloudflare R2 (imágenes de producto y logo del ticket, Fase 6). **Opcional como grupo** |
| `R2_ACCESS_KEY_ID` | Solo servidor | Token de API de R2 (Object Read & Write, limitado a `R2_BUCKET`). **Opcional como grupo** |
| `R2_SECRET_ACCESS_KEY` | Solo servidor | Secreto del token anterior. **Opcional como grupo** |
| `R2_BUCKET` | Solo servidor | Bucket privado (nunca público) donde se guardan las imágenes. **Opcional como grupo** |
| `R2_ENDPOINT_OVERRIDE` | Solo servidor | **Solo desarrollo local, opcional e independiente del grupo anterior.** Sustituye el host real de R2 por un endpoint S3 compatible (el contenedor MinIO de `docker-compose.r2.yml`), usado por el servidor para subir/borrar. Nunca se define en producción |
| `R2_PUBLIC_ENDPOINT_OVERRIDE` | Solo servidor | **Solo desarrollo local, opcional.** Host que usa el *navegador* para las URLs firmadas (p. ej. `http://localhost:9000`); distinto de `R2_ENDPOINT_OVERRIDE` cuando la app corre dentro de Docker y MinIO se referencia por nombre de contenedor (`http://r2:9000`) para ese tráfico servidor-a-servidor. Si no se define, usa el mismo valor que `R2_ENDPOINT_OVERRIDE` |
| `RESEND_API_KEY` | Solo servidor | API key de Resend (alertas por correo). **Opcional como grupo** con las otras cuatro de notificaciones |
| `EMAIL_FROM` | Solo servidor | Remitente de las alertas (p. ej. `Barstock <alerts@ejemplo.com>`). **Opcional como grupo** |
| `VAPID_PUBLIC_KEY` | Solo servidor | Clave pública VAPID (Web Push). **Opcional como grupo** |
| `VAPID_PRIVATE_KEY` | Solo servidor | Clave privada VAPID. **Opcional como grupo** |
| `VAPID_SUBJECT` | Solo servidor | Subject VAPID (`mailto:` o `https:`). **Opcional como grupo** |

Plantilla versionada: [`.env.example`](../../.env.example). Copiarla a `.env.local`.

### R2 (imágenes), opcional como grupo

Las cuatro variables `R2_*` se validan juntas con `superRefine` en `lib/env/schema.ts`: **las cuatro o ninguna**. Sin ellas, `next
dev`/`next build` funcionan igual (a diferencia de las otras variables, que son obligatorias), y `lib/server/storage.ts` responde
`503 storage_not_configured` en los endpoints de imagen (`app/api/v1/products/[id]/image`, `app/api/v1/settings/logo`); la UI oculta el
selector de imagen en ese caso. El bucket es **privado**: las imágenes se sirven con URL firmada (12 h), nunca públicas. El token de R2
debe estar limitado a ese único bucket con permiso "Object Read & Write" (no se crea el token real en este repositorio, solo se
documenta el requisito).

### R2 en local (MinIO), sin credenciales reales

`bun run local:up` y `bun run local:dev` levantan también un contenedor [MinIO](https://min.io) (`docker-compose.r2.yml`) que emula la
API S3 de R2, con un bucket ya creado y credenciales locales fijas. `R2_ENDPOINT_OVERRIDE=http://r2:9000` (dentro de la red Docker) hace
que `lib/server/storage.ts` firme y suba objetos contra ese contenedor en vez del R2 real — así se puede probar la subida de imágenes de
producto y del logo del ticket de principio a fin sin credenciales de Cloudflare. `R2_PUBLIC_ENDPOINT_OVERRIDE=http://localhost:9000`
hace que las URLs firmadas que recibe el navegador usen un host que sí puede resolver (el navegador corre en el host, fuera de la red de
Docker; `r2` como nombre de host solo existe dentro de esa red). Consola web: `http://localhost:9001` (usuario/clave `barstock-local` /
`barstock-local-2026`). Ninguna de las dos variables debe definirse fuera de este flujo local; en Vercel/CI se dejan sin definir para
hablar con el R2 real.

### Notificaciones (email + push), opcionales como grupo **[Por verificar]**

Las cinco variables `RESEND_API_KEY`, `EMAIL_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` se
validan juntas con `superRefine` en `lib/env/schema.ts`: **las cinco o ninguna**. Sin ellas, `next build` /
`next dev` siguen funcionando. `dispatchOutbox` omite el correo si faltan Resend/`EMAIL_FROM` y el push si falta
cualquier `VAPID_*`. Generar VAPID: `bunx web-push generate-vapid-keys`. Detalle del módulo:
[`03-modulos/notificaciones.md`](../03-modulos/notificaciones.md).

## Validación

- El esquema vive en `lib/env/schema.ts` (zod). `parseEnv()` lanza `EnvError` con **una línea por variable** (`X: missing` o el motivo
  de invalidez); las cadenas vacías cuentan como ausentes.
- `next.config.ts` valida el esquema completo, así que **`next dev` y `next build` fallan al arrancar** con un mensaje claro:
  ```
  Invalid environment variables:
    - NEXT_PUBLIC_SUPABASE_URL: missing
    - SUPABASE_SERVICE_ROLE_KEY: missing
  Copy .env.example to .env.local and fill in the missing values.
  ```
- `lib/env/client.ts` (`clientEnv`) solo exige las dos `NEXT_PUBLIC_*`; es lo único que puede importar código de navegador.
- `lib/env/server.ts` (`serverEnv`, con `import 'server-only'`) exige las cuatro. Importarlo desde un componente cliente rompe el build.

## Reglas

1. **Nunca** poner la clave `service_role` en una variable `NEXT_PUBLIC_*` ni en código cliente: salta RLS.
2. Las variables `NEXT_PUBLIC_*` se resuelven **en tiempo de build**: cambiarlas exige reconstruir. Por eso `client.ts` las referencia
   una a una (`process.env.NEXT_PUBLIC_X`); Next no incrusta `process.env` pasado entero.
3. `.env*` está en `.gitignore`, salvo `.env.example`. No subir claves reales.
4. Un proyecto Supabase **por entorno** (desarrollo, staging, producción), cada uno con su URL y claves.
5. En Vercel/CI hay que definir **las cuatro** antes del primer build (también `SUPABASE_SERVICE_ROLE_KEY`, porque `next.config.ts` la valida).

## Archivos

| Archivo | Versionado | Uso |
|---|---|---|
| `.env.local` | No | Desarrollo local. Prioridad alta en Next |
| `.env.example` | **Sí** | Plantilla |
| Panel de Vercel → *Environment Variables* | — | Producción/Preview |

## Cabeceras de seguridad relacionadas

`next.config.ts` añade CSP, `frame-ancestors 'none'`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS y
`Permissions-Policy`. `connect-src` incluye el origen de `NEXT_PUBLIC_SUPABASE_URL` **mientras el navegador siga llamando a Supabase
directamente**; se retira cuando la UI solo hable con `/api/v1` (Paso 5). `script-src` conserva `'unsafe-inline'`: una CSP con nonce
obligaría a renderizar dinámicamente todas las páginas. `img-src` permite siempre `https://*.r2.cloudflarestorage.com` (patrón fijo de
R2, no un secreto) **y** `http://localhost:9000` / `http://127.0.0.1:9000` (MinIO local de `docker-compose.r2.yml`). **No** se deriva de
`R2_ACCOUNT_ID`: `next.config.ts` se evalúa en el *build* y la imagen Docker se construye sin las variables `R2_*` (llegan al arrancar el
contenedor), así que un origen derivado quedaba fuera de la CSP y el navegador bloqueaba las imágenes en silencio — lo mismo pasaba con
MinIO cuando la CSP solo listaba el host de Cloudflare.

## Rotación y compromiso de claves

| Situación | Acción |
|---|---|
| Se filtró la clave `anon` | No es un secreto; verificar que RLS es correcta. Rotar solo si se sospecha de abuso (Supabase → *JWT Settings*) |
| Se filtró la clave `service_role` | **Rotar de inmediato** (regenerar el JWT secret), revisar logs de acceso y auditar datos |
| Cambio de proyecto Supabase | Actualizar las variables en cada entorno y **reconstruir** |
