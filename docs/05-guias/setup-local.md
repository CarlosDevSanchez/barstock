# Puesta en marcha local (verificada)

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

### 2. Base de datos (SQL Editor de Supabase, en este orden)
1. `supabase/schema.sql`
2. `supabase/fix_rls_policies.sql` — **solo en desarrollo**. Abre RLS a cualquier usuario autenticado
   ([C1](../04-auditoria/hallazgos/C1-rls-permisivo.md)). Es necesario hoy para poder vender con el esquema actual.
3. `supabase/seed.sql` (opcional). Ejecutar **una sola vez** (no es idempotente).

Detalles y advertencias: [seed y migraciones](../02-base-de-datos/06-seed-y-migraciones.md).

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
En Supabase → *Authentication → Providers → Email*: desactivar **Confirm email** en el proyecto de desarrollo
(o confirmar manualmente los usuarios desde el panel).

### 5. Arrancar
```bash
bun run dev          # http://localhost:3000
```

### 6. Crear el primer usuario y darle rol admin
1. Registrarse en `/register` (el selector de rol se ignora: todos nacen `cashier`).
2. Promover desde el SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'tu@correo.com';
   ```
   (Desde el SQL Editor `auth.uid()` es nulo, por lo que un futuro trigger de protección de rol no debe bloquear este paso;
   ver [diseño objetivo](../06-roadmap/diseno-objetivo-seguridad.md).)

### 7. Crear stock
No hay pantalla para crear inventario. Para probar ventas, el seed ya crea filas de `inventory` para 5 productos.
Para un producto nuevo:
```sql
insert into public.inventory (product_id, quantity, low_stock_threshold)
values ('<product uuid>', 50, 10);
```

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
| Login correcto pero las pantallas salen vacías | RLS sin políticas para el rol (no se ejecutó `fix_rls_policies.sql`) o la sesión no cargó el perfil | Revisar políticas con las consultas de [RLS](../02-base-de-datos/03-rls-y-politicas.md) |
| "Invalid login credentials" tras registrarse | Email sin confirmar | Confirmar el email o desactivar la confirmación en desarrollo |
| El enlace de "olvidé mi contraseña" da 404 | `/reset-password` no existe ([H4](../04-auditoria/hallazgos/H4-flujos-incompletos.md)) | Restablecer desde el panel de Supabase |
| El stock no baja tras una venta | Hipótesis de [C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md) | Seguir [verificar-checkout](verificar-checkout.md) |
| No se puede crear el segundo producto/cliente sin código/email | Cadena vacía contra columna `UNIQUE` ([M14](../04-auditoria/hallazgos/medios-y-bajos.md)) | Rellenar el campo o corregir el formulario |
| Error por categoría al crear producto | `category_id: ''` inválido para `uuid` | Elegir una categoría |
