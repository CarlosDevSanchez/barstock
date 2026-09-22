# Variables de entorno

> Actualizado en la etapa 1 (Paso 2). Confianza: **[Verificado]** (`lib/env/schema.ts`, `next.config.ts`, `lib/env/schema.test.ts`).

## Variables

| Variable | Visibilidad | Descripción |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Pública** (se incrusta en el bundle del navegador) | URL del proyecto Supabase. En local: `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Pública** | Clave `anon` (JWT). No es secreta por diseño: la seguridad depende de RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **Solo servidor** | Clave `service_role`. **Salta RLS.** Se usa únicamente para invitar usuarios (`auth.admin`) |
| `APP_URL` | Solo servidor | URL pública de la app; base de los enlaces de invitación y de restablecer contraseña |

Plantilla versionada: [`.env.example`](../../.env.example). Copiarla a `.env.local`.

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
obligaría a renderizar dinámicamente todas las páginas.

## Rotación y compromiso de claves

| Situación | Acción |
|---|---|
| Se filtró la clave `anon` | No es un secreto; verificar que RLS es correcta. Rotar solo si se sospecha de abuso (Supabase → *JWT Settings*) |
| Se filtró la clave `service_role` | **Rotar de inmediato** (regenerar el JWT secret), revisar logs de acceso y auditar datos |
| Cambio de proyecto Supabase | Actualizar las variables en cada entorno y **reconstruir** |
