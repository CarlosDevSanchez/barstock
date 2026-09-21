# Convenciones de código

> Parte descriptiva (estilo **observado**) y parte normativa (reglas para código **nuevo**).
> Base: commit `54962b9`. No hay Prettier ni EditorConfig que lo imponga; este documento lo fija.

## Estilo observado

| Aspecto | En `app/`, `stores/` | En archivos del scaffold (`app/layout.tsx`, `components/ui/*`, `lib/utils.ts`) |
|---|---|---|
| Indentación | 4 espacios | 2 espacios |
| Punto y coma | No | Sí (en `app/layout.tsx`, `next.config.ts`) / No en `lib/utils.ts` |
| Comillas | Simples | Dobles |
| Directiva | `"use client"` (dobles) en la primera línea | — |
| Alias | `@/…` para todo | `@/…` |

**Regla:** en código nuevo seguir el estilo de `app/` y `stores/` (4 espacios, sin `;`, comillas simples). No reformatear archivos
no relacionados con el cambio (evita ruido en el diff). Al introducir Prettier, hacerlo en un commit aparte.

## Nombres

| Elemento | Convención | Ejemplo |
|---|---|---|
| Archivos de ruta | `page.tsx`, `layout.tsx` en carpetas en minúsculas/kebab | `forgot-password/page.tsx` |
| Componentes de página | `PascalCase` + `Page` | `POSPage`, `ProductsPage`, `OrderDetailPage` |
| Handlers | `handleX` | `handleCheckout`, `handleSubmit`, `handleDelete` |
| Cargadores de datos | `fetchX` | `fetchProducts`, `fetchOrderDetails` |
| Estado de diálogo | `showDialog`, `editingX` | `editingProduct` |
| Estado de formulario | `formData` | |
| Búsqueda | `searchQuery`, `filteredX` | |
| Stores | `useXStore` en `stores/x.ts` | `useCartStore` |
| Tipos de dominio | `PascalCase` singular, en `types/` | `Product`, `OrderItem` |
| Columnas/BD | `snake_case` | `selling_price`, `created_by` |
| Constantes | `UPPER_SNAKE` en objetos `as const` | `ORDER_STATUS` |

## Orden de imports (observado)

1. `react` / `next/*`
2. Componentes `@/components/ui/*`
3. `@/lib/*`, `@/stores/*`
4. Librerías (`sonner`, `lucide-react`, `date-fns`)
5. Tipos (`import type … from '@/types'`)

## Reglas para código nuevo

### Datos y seguridad
1. **Nunca** confiar en importes, precios ni permisos calculados en el cliente para escribir en la BD. Las escrituras multi-tabla van por **RPC transaccional** ([C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md)).
2. Toda tabla nueva: `ENABLE ROW LEVEL SECURITY` y políticas **por rol** desde el primer commit. No añadir políticas `USING (true)` ni `auth.role() = 'authenticated'` como única condición.
3. Toda entrada pasa por un esquema **zod** (`lib/validation/`) y la BD la refuerza con `CHECK`/`NOT NULL`/enum.
4. Convertir cadenas vacías en `null` antes de enviar a columnas opcionales o `UNIQUE`.
5. Filtrar `NULL` con `.is('col', null)`, **nunca** `.eq('col', null)`.
6. Dinero: `NUMERIC` en BD; en cliente, enteros de centavos o formateo con `Intl.NumberFormat`; nada de `toFixed` para cálculos.
7. Comprobar siempre `{ error }` de cada llamada a Supabase; no asumir que `try/catch` captura errores de consulta (no lanzan).
8. No usar `any`: `unknown` en `catch` y tipos generados de Supabase para los embeds.

### Estructura
9. Lógica de acceso a datos en `lib/data/<recurso>.ts`; las páginas solo componen.
10. Componentes reutilizables de dominio en `components/<dominio>/`; no copiar spinners/cabeceras entre páginas.
11. Preferir Server Components para lecturas; `"use client"` solo donde haya interacción o estado.
12. No guardar objetos de dominio completos en stores persistidos; guardar ids.

### UI
13. Reutilizar `components/ui/*`. Acciones destructivas con `AlertDialog`, no `confirm()`.
14. Botones de icono con `aria-label`; `Label` con `htmlFor`.
15. Formatear dinero y fechas con la configuración de la tienda (moneda y zona horaria de ajustes).

### Calidad
16. `bun run lint`, `bun run typecheck` y `bun run format:check` deben pasar antes de abrir el PR.
17. Toda lógica de negocio nueva lleva pruebas (Vitest) y toda migración se prueba en staging.
18. Cambios de esquema/RLS/flujos actualizan `docs/` en el mismo PR.

## Git

- Historial actual: 2 commits, mensaje en una línea en inglés, sin convención formal.
- Propuesta: Conventional Commits en inglés (`fix(pos): use .is() for null variant`), ramas `feat/…`, `fix/…`, `chore/…`, PR con checklist de [comandos](comandos.md#lista-de-comprobación-antes-de-un-pr).
- Los commits creados con ayuda de Claude Code terminan con la línea `Co-Authored-By` indicada por la herramienta.

## Idioma

- Interfaz de usuario actual: **inglés**. Decisión pendiente si se traduce ([decisiones-pendientes](../06-roadmap/decisiones-pendientes.md)); mientras tanto, mantener inglés en la UI.
- Código, commits y nombres: inglés.
- Documentación interna (`docs/`, `AGENTS.md`, `CLAUDE.md`): **español**.
