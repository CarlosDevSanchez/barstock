# Puesta en marcha local (verificada)

> ¿Solo quieres **verlo funcionando**? `bun run local:up` levanta todo en Docker con usuarios de prueba: [docker-local](docker-local.md). Esta guía es para **desarrollar** con recarga en caliente.

> Sustituye a la sección "Installation" del README, que está desactualizada ([readme-vs-realidad](../04-auditoria/readme-vs-realidad.md)).
> Herramientas migradas a Bun. El flujo de base de datos y usuarios (secciones 2, 4, 6 y 7) describe el estado **anterior** a la
> migración de seguridad y se reescribe en el Paso 8 de la etapa 1.

## Requisitos

| Requisito | Versión | Nota |
|---|---|---|
| Node.js | `>= 20.9.0` (Next 16); `.nvmrc` fija `24` | Lo usa Next para compilar y servir |
| Bun | `>= 1.4.1` (`packageManager: bun@1.4.1`) | Gestor de paquetes y ejecutor de tests. `bun install --frozen-lockfile` respeta `bun.lock` |
| Proyecto Supabase | uno **de desarrollo** | No usar el de producción para pruebas |

## Pasos

### 1. Dependencias
```bash
cd barstock
bun install --frozen-lockfile
```

### 2. Base de datos local (Supabase CLI + Docker)
```bash
# requiere Docker Desktop activo y la Supabase CLI (brew install supabase/tap/supabase)
bun run db:start          # aplica supabase/migrations/* y supabase/seed.sql
supabase status -o env    # API_URL, ANON_KEY, SERVICE_ROLE_KEY para .env.local
```
Detalles: [seed y migraciones](../02-base-de-datos/06-seed-y-migraciones.md). Ya no se pegan `schema.sql`/`fix_rls_policies.sql` en el SQL Editor
(están en `supabase/legacy/`, solo como historia). Para un proyecto hospedado, ver "Aplicar a una base existente" en ese documento.

### 3. Variables de entorno
Crear `.env.local` en la raíz (ver [variables-de-entorno](variables-de-entorno.md)):
Copiar `.env.example` a `.env.local` y rellenar las 4 variables (URL, anon key, service role key, `APP_URL`):
```env
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # solo servidor
APP_URL=http://localhost:3000
```

### 4. Autenticación en desarrollo
Local ya viene configurado (`supabase/config.toml`): registro público **cerrado**, confirmación de email activa y correos en Mailpit
(<http://127.0.0.1:54324>). No hay que tocar nada.

### 5. Arrancar
```bash
bun run dev          # http://localhost:3000
```

### 6. Crear usuarios para entrar
No hay registro público: los usuarios se crean por invitación de un admin, y el primero hay que crearlo aparte.

**Lo fácil:** `bun run local:seed` crea `admin@`, `manager@` y `cashier@barstock.local` (contraseña `barstock-local-2026`, **solo local**) y unas ventas de demostración; es idempotente y se niega a ejecutarse contra un host que no sea local ([docker-local](docker-local.md)).

**A mano** (con la API de administración de Auth; el trigger asigna el rol y activa el perfil cuando `app_metadata.role` cambia):
```bash
. <(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')
curl -s -X POST "$API_URL/auth/v1/admin/users" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local.dev","password":"a-long-local-password","email_confirm":true,"app_metadata":{"role":"admin"}}'
```
Los demás usuarios se invitan desde `/users` con ese admin (el correo llega a Mailpit, <http://127.0.0.1:54324>).

### 7. Stock
Cada producto recibe su fila de `inventory` (cantidad 0) por trigger; el seed fija las cantidades iniciales. Para ajustar stock se usa el RPC
`adjust_inventory` (gerente/admin, con motivo), no `INSERT`/`UPDATE` directos (están revocados).

## Verificación rápida

```bash
bun run typecheck                    # debe terminar sin salida
bun run lint                         # HOY falla (ver lint-y-tipos); desaparece con el refactor a API
bun run build                        # requiere las variables de entorno
```

## Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `Invalid environment variables: X: missing` al ejecutar `dev`/`build` | Falta esa variable | Definirla en `.env.local` ([variables](variables-de-entorno.md), [H5](../04-auditoria/hallazgos/H5-build-sin-env.md)) |
| `npx tsc` imprime "This is not the tsc command you are looking for" | `typescript` no está instalado y npx descargó un paquete `tsc` distinto | `bun install` y usar `bun run typecheck` |
| Login correcto pero las pantallas salen vacías | El perfil está inactivo (`is_active = false`): no pasa ninguna política | Activarlo (admin) o crearlo con `app_metadata.role` |
| El enlace de "olvidé mi contraseña" da 404 | `/reset-password` no existe todavía ([H4](../04-auditoria/hallazgos/H4-flujos-incompletos.md), Paso 5) | Restablecer con la API de administración |
| El stock no baja tras una venta | El POS actual no usa `create_sale` aún | Llega con el refactor del POS (Paso 5); el RPC ya descuenta stock ([verificado](../02-base-de-datos/04-triggers-y-funciones.md)) |
| No se puede crear el segundo producto/cliente sin código/email | Cadena vacía contra columna `UNIQUE` ([M14](../04-auditoria/hallazgos/medios-y-bajos.md)) | Rellenar el campo o corregir el formulario |
| Error por categoría al crear producto | `category_id: ''` inválido para `uuid` | Elegir una categoría |
