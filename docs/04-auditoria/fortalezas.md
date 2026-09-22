# Fortalezas (lo que conviene conservar)

> Auditar no es solo listar fallos. Estos puntos son sólidos y no deben romperse al remediar.

| Fortaleza | Evidencia | Por qué importa |
|---|---|---|
| **TypeScript estricto y sin errores** | `strict: true`; `tsc --noEmit` exit 0 | Base para tipos generados y refactors seguros |
| **Sin secretos en el repositorio** | `.env*` ignorado; ningún `.env`/clave en el historial (2 commits) | Sin credenciales expuestas |
| **Solo la clave pública (anon) en el cliente** | No hay `service_role` en el código | Modelo correcto de Supabase; la protección debe venir de RLS |
| **Sin superficie de inyección SQL** | Sin `rpc`, SQL crudo ni `.or()`/`.ilike()` con entrada del usuario; PostgREST parametriza | Riesgo de SQLi prácticamente nulo |
| **Sin XSS por HTML inyectado** | Sin `dangerouslySetInnerHTML`/`eval`; React escapa la salida | |
| **RLS habilitada en las 15 tablas** | `schema.sql:256-270` | Estructura correcta; falta afinar las políticas ([C1](hallazgos/C1-rls-permisivo.md)) |
| **`anon` sin acceso a datos** | Ninguna política para `anon` | Un visitante sin cuenta no lee nada |
| **Esquema razonablemente normalizado** | Enums, FKs, `NUMERIC` para dinero, `UNIQUE` en identificadores | Buena base; faltan `CHECK` e índices |
| **Bitácora de inventario diseñada** | `inventory_transactions` con tipo, cantidad, referencia y autor | Solo falta usarla en todos los flujos |
| **Triggers de `updated_at`** | 10 tablas | Auditoría temporal básica |
| **Estructura de carpetas clara** | `(auth)`/`(dashboard)`, `stores/`, `types/`, `components/ui/` | Fácil de navegar |
| **Sistema de diseño consistente** | shadcn + Tailwind 4, tema claro/oscuro, patrones repetidos | UI coherente |
| **Lockfile versionado** | `package-lock.json` | Builds reproducibles |
| **Tema y layout responsive** | Sidebar + `Sheet` móvil, grids con breakpoints (**[Inferido]**) | |
| **Toasts y estados de carga** | Sonner, spinners | Retroalimentación básica al usuario |
| **Sin dependencias abandonadas evidentes** | Stack moderno (Next 16, React 19, Tailwind 4, Zustand 5, zod 4) | Pocas migraciones forzadas |

## Cómo conservarlas

- Mantener `strict` y añadir `noUncheckedIndexedAccess` sin relajar nada.
- No introducir `service_role` en código cliente; si hace falta en servidor, solo en variables **sin** prefijo `NEXT_PUBLIC_`.
- Al mover a RPC/Server Actions, seguir parametrizando (nunca concatenar SQL).
- Preservar la bitácora `inventory_transactions` como registro inmutable.
