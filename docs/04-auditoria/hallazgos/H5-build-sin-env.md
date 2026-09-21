# H5 — El build falla sin variables de entorno (y no hay validación de env)

| | |
|---|---|
| **Severidad** | Alto (DevOps / DX) |
| **Área** | Configuración y despliegue |
| **Esfuerzo** | Pequeño |
| **Estado** | En curso (validación con zod y `.env.example` hechos; falta CI) |
| **Confianza** | **[Verificado]** ejecutando `next build` |

## Hallazgo

`next build` en un clon limpio (sin `.env.local`) termina con:

```
Error occurred prerendering page "/forgot-password".
Error: supabaseUrl is required.
Export encountered an error on /(auth)/forgot-password/page: /forgot-password, exiting the build.
```

Causa: `lib/supabase/client.ts:3-6` lee `process.env.NEXT_PUBLIC_SUPABASE_URL!` y llama a `createClient` **al importar el módulo**;
Next evalúa las páginas cliente durante el prerender y el módulo lanza.

Agravantes:
- Los `!` (non-null assertion) silencian a TypeScript; no hay validación ni mensaje claro.
- No existe `.env.example`: el README pide copiar `.env.local.example`, que no está en el repo; y `.gitignore` con `.env*` impediría versionarlo.
- Variables `NEXT_PUBLIC_*` se incrustan **en tiempo de build**; en Vercel deben existir antes del primer despliegue.
- Sin `engines`/`.nvmrc`: la versión de Node no está fijada.

## Impacto

Builds de CI/CD rotos hasta configurar secretos, mensajes de error poco útiles, onboarding lento y despliegues frágiles.

## Recomendación

1. `lib/env.ts` con zod:
   ```ts
   const schema = z.object({
     NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
     NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
   })
   export const env = schema.parse({
     NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
     NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
   })
   ```
   y usarlo en el cliente de Supabase (mensaje claro al faltar).
2. Versionar `.env.example` y añadir `!.env.example` al `.gitignore`.
3. En CI, definir esas variables (o un proyecto Supabase de prueba) para el paso `build`.
4. Fijar Node (`"engines": { "node": ">=20" }` y `.nvmrc`).
5. Documentar las variables en [`variables-de-entorno.md`](../../05-guias/variables-de-entorno.md).

## Criterios de aceptación

- [ ] `bun run build` con variables definidas termina correctamente en CI. (Local ✅; el CI llega en el Paso 7.)
- [x] Sin variables, el error indica cuál falta (`EnvError` desde `next.config.ts`; probado en `lib/env/schema.test.ts`).
- [ ] `.env.example` está versionado (✅) y el README lo referencia correctamente (pendiente: se reescribe en el Paso 8).
- [x] La versión de Node está declarada (`engines`, `.nvmrc`).
