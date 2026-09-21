# Variables de entorno

> Base: commit `54962b9` · Confianza: **[Verificado]** (uso en `lib/supabase/client.ts`).

## Variables requeridas

| Variable | Dónde se usa | Visibilidad | Descripción |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase/client.ts:3` | **Pública** (se incrusta en el bundle del navegador) | URL del proyecto Supabase, `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase/client.ts:4` | **Pública** | Clave `anon` (JWT). No es secreta por diseño: la seguridad depende de RLS |

No hay otras variables. Ningún archivo lee `process.env` fuera de `lib/supabase/client.ts`.

## Reglas

1. **Nunca** poner la clave `service_role` en una variable `NEXT_PUBLIC_*` ni en código cliente: salta RLS.
   Si en el futuro se necesita en el servidor (Server Actions, rutas `app/api`), usar una variable **sin** prefijo
   `NEXT_PUBLIC_` (p. ej. `SUPABASE_SERVICE_ROLE_KEY`) y solo en código de servidor.
2. Las variables `NEXT_PUBLIC_*` se resuelven **en tiempo de build**: cambiarlas exige reconstruir.
3. `.env*` está en `.gitignore`. Para versionar la plantilla hay que añadir `!.env.example` al `.gitignore` ([H5](../04-auditoria/hallazgos/H5-build-sin-env.md)).
4. Un proyecto Supabase **por entorno** (desarrollo, staging, producción), cada uno con su URL y clave.

## Archivos

| Archivo | Versionado | Uso |
|---|---|---|
| `.env.local` | No | Desarrollo local. Prioridad alta en Next |
| `.env.example` | **Debería** (hoy no existe) | Plantilla sin valores |
| Panel de Vercel → *Environment Variables* | — | Producción/Preview. Definir **antes** del primer build |

Plantilla propuesta para `.env.example`:

```env
# Supabase (Project Settings → API)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Validación propuesta

`lib/env.ts` con zod (ver ejemplo completo en [H5](../04-auditoria/hallazgos/H5-build-sin-env.md#recomendación)) y usarlo en
`lib/supabase/client.ts` en lugar de los `!`. Hoy, si faltan, el error es `supabaseUrl is required` y **rompe `next build`**.

## Rotación y compromiso de claves

| Situación | Acción |
|---|---|
| Se filtró la clave `anon` | No es un secreto; verificar que RLS es correcta. Rotar solo si se sospecha de abuso (Supabase → *JWT Settings*) |
| Se filtró la clave `service_role` | **Rotar de inmediato** (regenerar el JWT secret), revisar logs de acceso y auditar datos |
| Cambio de proyecto Supabase | Actualizar las dos variables en cada entorno y **reconstruir** |

Política de rotación periódica: no documentada en el proyecto. Definirla junto con [decisiones-pendientes](../06-roadmap/decisiones-pendientes.md).

## Verificación

```bash
# Debe fallar con un mensaje claro si faltan (tras implementar lib/env.ts)
NEXT_PUBLIC_SUPABASE_URL= bun run build
```
