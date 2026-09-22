# Levantar todo en local con Docker

> Confianza: **[Verificado]** (ejecutado desde cero en macOS/arm64 con Docker Desktop: arranque completo, login con los tres roles en Chromium y flujo de invitación a través del contenedor). No probado en Linux ni en Windows.
> **Solo para desarrollo y revisión local.** No es un despliegue: la imagen se construye contra un Supabase local con claves de demostración públicas.

## Un comando

```bash
bun run local:up
```

Requisitos: **Docker Desktop activo**, **Supabase CLI** (`brew install supabase/tap/supabase`) y **Bun**. La primera vez descarga imágenes y construye la app (unos 1–3 minutos; las siguientes veces, segundos).

| Paso | Qué hace |
|---|---|
| 1. Supabase | `supabase start`: base de datos (aplica las migraciones y el seed de catálogo), Auth, API, Mailpit |
| 2. Semilla de usuarios | `scripts/seed-local.ts`: crea los usuarios de abajo y unas ventas de demostración |
| 3. La app | `docker compose up -d --build`: imagen de producción de la app en el puerto 3000 |

Al terminar imprime las URLs y las credenciales.

## Accesos

| | URL |
|---|---|
| **App** | <http://localhost:3000> |
| **Mailpit** (correos de invitación y recuperación) | <http://127.0.0.1:54324> |
| **Studio** (explorar la base de datos) | <http://127.0.0.1:54323> |

**Usuarios sembrados** (contraseña de los tres: `barstock-local-2026`):

| Usuario | Rol | Qué ver |
|---|---|---|
| `admin@barstock.local` | admin | Todo: ajustes, usuarios (invitar, cambiar rol, desactivar), reportes |
| `manager@barstock.local` | manager | Catálogo, ajuste de stock, todas las órdenes y reembolsos, reportes, proveedores |
| `cashier@barstock.local` | cashier | Caja, catálogo (solo lectura), **solo sus propias órdenes**, sin `/settings`, `/users`, `/reports`, `/suppliers` |

Además se crean **6 ventas de demostración** (una reembolsada) para que el dashboard, las órdenes y los reportes no estén vacíos; solo si todavía no hay órdenes, así que repetir el comando no las duplica.
Cambiar la contraseña: `LOCAL_USERS_PASSWORD=otra-clave-larga bun run local:up` (mínimo 10 caracteres).

## Comandos

| Comando | Qué hace |
|---|---|
| `bun run local:up` | Levanta todo (idempotente: repetirlo es seguro y restablece la contraseña y el rol de los usuarios sembrados) |
| `bun run local:seed` | Solo la semilla de usuarios y ventas (con Supabase ya en marcha) |
| `bun run local:down` | Para la app y Supabase; **conserva los datos** |
| `bun run local:reset` | Para todo y **borra la base de datos** (la próxima vez, arranque limpio) |
| `APP_PORT=3001 bun run local:up` | Otro puerto si el 3000 está ocupado |
| `docker compose --env-file .env.docker logs -f app` | Logs de la app |

Para **programar** (recarga en caliente) no uses el contenedor: `bun run db:start` y `bun run dev` ([setup local](setup-local.md)). El contenedor es para *ver* la app tal como se despliega. Si cambias código, vuelve a ejecutar `bun run local:up` (reconstruye la imagen).

## Cómo funciona

- **`Dockerfile`** (multi-etapa): Node 24 + Bun 1.4.1 (la versión de `package.json`), `bun install --frozen-lockfile`, `bun run build`, `bun run start`. Corre como usuario `node` (no root) y tiene *healthcheck*.
- **`docker-compose.yml`**: solo define la app. Se une a la red `supabase_network_barstock` que crea la Supabase CLI y llega a la API por nombre (`http://supabase_kong_barstock:8000`); no necesita `host.docker.internal`.
- **`.env.docker`** (generado por `local-up.sh`, ignorado por git): las variables del Supabase local. Las `NEXT_PUBLIC_*` se **incrustan en el build**, por eso van como argumentos de build.
  La clave `service_role` **solo se pasa en tiempo de ejecución**: nunca queda en una capa de la imagen (comprobado con `docker history`); el build usa un marcador porque `next.config.ts` exige que la variable exista.
- **Cookies:** `Secure` depende de que `APP_URL` sea https (no de `NODE_ENV`). Por eso la imagen de producción sirve por `http://localhost` con cookies que también acepta Safari.
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
| `network supabase_network_barstock not found` | Supabase no está en marcha: usar `bun run local:up` (lo arranca), no `docker compose up` a secas |
| El login no avanza en Safari | Debería estar resuelto (las cookies no son `Secure` sobre http). Si `APP_URL` en `.env.docker` es https, no lo será |
| La app no arranca y el log dice que falta una variable | `.env.docker` ausente o incompleto: volver a ejecutar `bun run local:up` |
| Quieres empezar de cero | `bun run local:reset` y luego `bun run local:up` |

## Límites conocidos
- La imagen ocupa ~1,7 GB porque conserva las dependencias de desarrollo (Next carga `next.config.ts` y el build las usa). Es aceptable en local; para desplegar habría que podar la imagen.
- Las imágenes de Supabase (~2 GB) las descarga la Supabase CLI la primera vez.
- Probado solo con Docker Desktop en macOS/arm64.
