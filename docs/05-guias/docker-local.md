# Levantar todo en local con Docker

> Confianza: **[Verificado]** el modo `local:up` (ejecutado desde cero en macOS/arm64 con Docker Desktop: arranque completo, login con los tres roles en Chromium y flujo de invitación a través del contenedor). El modo `local:dev` (hot-reload) es **[Por verificar]**: la configuración de `docker compose` se validó con `docker compose config` pero no se ha ejecutado de punta a punta contra Docker Desktop. Ninguno probado en Linux ni en Windows.
> **Solo para desarrollo y revisión local.** No es un despliegue: la imagen se construye contra un Supabase local con claves de demostración públicas. El despliegue real es Vercel (D13, [decisiones-pendientes](../06-roadmap/decisiones-pendientes.md), sin decidir todavía).

## Dos modos

| | Comando | Qué corre dentro del contenedor | Cuándo usarlo |
|---|---|---|---|
| **Producción (imagen)** | `bun run local:up` | `next build` + `next start` | Ver la app tal como se despliega; probar el build antes de un cambio grande |
| **Desarrollo (hot-reload)** | `bun run local:dev` | `next dev`, repo montado como bind mount | Programar dentro de Docker (p. ej. sin Bun/Node en el host); los cambios se ven sin reconstruir la imagen |

Si ya tienes Bun instalado en el host, `bun run db:start` + `bun run dev` (sin Docker para la app) sigue siendo más simple y rápido — ver [setup local](setup-local.md).

## Un comando

```bash
bun run local:up      # imagen de producción
bun run local:dev     # hot-reload (Ctrl+C para parar)
```

Requisitos: **Docker Desktop activo**, **Supabase CLI** (`brew install supabase/tap/supabase`) y **Bun**. La primera vez descarga imágenes y construye la app (unos 1–3 minutos; las siguientes veces, segundos).

| Paso | `local:up` | `local:dev` |
|---|---|---|
| 1. Supabase | `supabase start`: base de datos (aplica las migraciones y el seed de catálogo), Auth, API, Mailpit | igual |
| 2. Semilla de usuarios | `scripts/seed-local.ts`: crea solo los usuarios de abajo (nada más: el catálogo viene de `supabase/seed.sql`, sin ventas) | igual |
| 3. La app | `docker compose up -d --build`: imagen de producción en el puerto 3000, en segundo plano | `docker compose up --build`: `next dev` en primer plano (deja la terminal abierta) |

Al terminar (o al arrancar, en el caso de `local:dev`) imprime las URLs y las credenciales.

## Accesos

| | URL |
|---|---|
| **App** | <http://localhost:3000> |
| **Mailpit** (correos de invitación y recuperación) | <http://127.0.0.1:54324> |
| **Studio** (explorar la base de datos) | <http://127.0.0.1:54323> |
| **R2 (MinIO)** — imágenes de producto y logo del ticket | <http://localhost:9001> (`barstock-local` / `barstock-local-2026`) |

**Usuarios sembrados** (contraseña de los tres: `barstock-local-2026`):

| Usuario | Rol | Qué ver |
|---|---|---|
| `admin@barstock.local` | admin | Todo: ajustes, usuarios (invitar, cambiar rol, desactivar), reportes |
| `manager@barstock.local` | manager | Catálogo, ajuste de stock, todas las órdenes y reembolsos, reportes, proveedores |
| `cashier@barstock.local` | cashier | Caja, catálogo (solo lectura), **solo sus propias órdenes**, sin `/settings`, `/users`, `/reports`, `/suppliers` |

`scripts/seed-local.ts` **solo** crea/actualiza estos tres usuarios: no genera ventas, pedidos ni ningún otro dato. El catálogo de ejemplo (productos, categorías, clientes, proveedores) viene de `supabase/seed.sql`, aplicado siempre por `supabase start`/`db reset`.
Cambiar la contraseña: `LOCAL_USERS_PASSWORD=otra-clave-larga bun run local:up` (mínimo 10 caracteres).

## Comandos

| Comando | Qué hace |
|---|---|
| `bun run local:up` | Levanta la imagen de producción (idempotente: repetirlo es seguro y restablece la contraseña y el rol de los usuarios sembrados) |
| `bun run local:dev` | Levanta el modo hot-reload en primer plano (idempotente igual que `local:up`; `Ctrl+C` para parar) |
| `bun run local:seed` | Solo la semilla de usuarios y ventas (con Supabase ya en marcha) |
| `bun run local:down` | Para la app (el modo que esté corriendo) y Supabase; **conserva los datos** y el caché de `node_modules`/`.next` de `local:dev` |
| `bun run local:reset` | Para todo y **borra la base de datos** y el caché de `local:dev` (la próxima vez, arranque limpio) |
| `APP_PORT=3001 bun run local:up` (o `local:dev`) | Otro puerto si el 3000 está ocupado |
| `docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.r2.yml --env-file .env.docker logs -f app` | Logs de la app en modo `local:up` |

## Cómo funciona

- **`Dockerfile`** (multi-etapa): Node 24 + Bun 1.4.1 (la versión de `package.json`), `bun install --frozen-lockfile`. Dos objetivos (`--target`) a partir de la misma capa de dependencias: `run` (`bun run build` + `bun run start`, usuario `node` no root, con *healthcheck*) y `dev` (`bun run dev`, sin copiar el código: lo pone el bind mount).
- **`docker-compose.yml`**: define solo la app, portable: construye y corre la imagen de producción (`target: run`, el por defecto) contra **cualquier** Supabase alcanzable en `NEXT_PUBLIC_SUPABASE_URL` (local o hospedado). No asume la red del CLI; sirve como referencia de la imagen fuera de Vercel.
- **`docker-compose.local.yml`** (overlay, `local:up`): añade la unión a la red `supabase_network_barstock` que crea la Supabase CLI, para llegar a la API por nombre (`http://supabase_kong_barstock:8000`) sin `host.docker.internal`.
- **`docker-compose.dev.yml`** (overlay, `local:dev`): usa `target: dev`, monta el repositorio completo en `/app` y enmascara `/app/node_modules` y `/app/.next` con volúmenes con nombre (`node_modules`, `next_cache`) para que la instalación de dependencias hecha en la imagen no la tape el bind mount, y para que el caché de Next sobreviva entre reinicios. También se une a la red de la Supabase CLI.
- **`docker-compose.r2.yml`** (overlay, ambos modos): añade [MinIO](https://min.io) (`quay.io/minio/minio` — `minio/minio` ya no se publica en Docker Hub) como sustituto local de Cloudflare R2, con un bucket creado por un contenedor `r2-init` (`mc mb`) que corre una vez y termina. Define las cuatro variables `R2_*` (credenciales locales fijas), `R2_ENDPOINT_OVERRIDE=http://r2:9000` para que el propio contenedor de la app suba/borre por nombre de contenedor, y `R2_PUBLIC_ENDPOINT_OVERRIDE=http://localhost:9000` para que las URLs firmadas que recibe el navegador (fuera de la red de Docker) sean alcanzables (`lib/server/storage.ts`, ver [variables de entorno](variables-de-entorno.md#r2-en-local-minio-sin-credenciales-reales)). La CSP (`img-src` en `next.config.ts`) también permite esos orígenes `localhost:9000` / `127.0.0.1:9000`; sin eso el navegador bloqueaba las imágenes en silencio aunque la subida y la firma estuvieran bien. Así la subida y visualización de imágenes de producto y del logo del ticket funciona de punta a punta sin credenciales reales de Cloudflare.
- **`.env.docker`** (generado por `local-up.sh`/`local-dev.sh`, ignorado por git): las variables del Supabase local. Para `local:up` las `NEXT_PUBLIC_*` se **incrustan en el build** (van como argumentos de build); para `local:dev` también se pasan como variables de entorno en tiempo de ejecución, que es lo que usa `next dev`.
  La clave `service_role` **solo se pasa en tiempo de ejecución**: nunca queda en una capa de la imagen (comprobado con `docker history`); el build de `run` usa un marcador porque `next.config.ts` exige que la variable exista.
- **Cookies:** `Secure` depende de que `APP_URL` sea https (no de `NODE_ENV`). Por eso la imagen sirve por `http://localhost` con cookies que también acepta Safari.
- Los correos de invitación enlazan a `http://localhost:3000` (la `site_url` de Supabase), que es el contenedor.

## Seguridad

- Las credenciales son **públicas y de demostración**. `scripts/seed-local.ts` **se niega a ejecutarse contra cualquier host que no sea `localhost`/`127.0.0.1`**, igual que las pruebas de integración.
- Las claves de `.env.docker` son las claves de demostración estándar de la Supabase CLI; el archivo no se versiona. No las reutilices en ningún otro entorno.
- Para un despliegue real hace falta otra cosa (variables reales, Supabase hospedado, HTTPS, regla de rama, etc.); ver [migraciones](../02-base-de-datos/06-seed-y-migraciones.md) y el [plan](../06-roadmap/plan-de-remediacion.md#estado-tras-la-etapa-1).

## Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `Docker is not running` | Abrir Docker Desktop |
| `Port 3000 is already in use` | Hay un `next dev`/`next start` viejo: `lsof -nP -iTCP:3000 -sTCP:LISTEN` y pararlo, o `APP_PORT=3001 bun run local:up` |
| `network supabase_network_barstock not found` | Supabase no está en marcha: usar `bun run local:up`/`local:dev` (lo arrancan), no `docker compose up` a secas |
| El login no avanza en Safari | Debería estar resuelto (las cookies no son `Secure` sobre http). Si `APP_URL` en `.env.docker` es https, no lo será |
| La app no arranca y el log dice que falta una variable | `.env.docker` ausente o incompleto: volver a ejecutar `bun run local:up`/`local:dev` |
| `local:dev`: cambié `package.json`/instalé un paquete y no aparece | El volumen `node_modules` guarda la instalación hecha al construir la imagen; reconstruir con `docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.docker up --build` (o `bun run local:reset` si quieres empezar de cero) |
| Subir una imagen de producto da `503 storage_not_configured` | El contenedor `r2-init` no terminó de crear el bucket antes de que arrancara la app (arranque en frío lento), o `docker-compose.r2.yml` no se incluyó en el comando. Esperar unos segundos y reintentar, o revisar `docker compose ... logs r2-init` |
| Quieres empezar de cero | `bun run local:reset` y luego `bun run local:up` o `local:dev` |

## Límites conocidos
- La imagen `run` ocupa ~1,7 GB porque conserva las dependencias de desarrollo (Next carga `next.config.ts` y el build las usa). Es aceptable en local; para desplegar habría que podar la imagen.
- `local:dev` solo detecta cambios de código (recarga en caliente de Next); un cambio en dependencias (`package.json`/`bun.lock`) requiere reconstruir la imagen (ver tabla de arriba).
- Las imágenes de Supabase (~2 GB) las descarga la Supabase CLI la primera vez.
- Probado solo con Docker Desktop en macOS/arm64.
- MinIO (`docker-compose.r2.yml`) se descarga de `quay.io`, no de Docker Hub: `minio/minio` dejó de publicarse ahí. Requiere acceso a `quay.io` la primera vez.
