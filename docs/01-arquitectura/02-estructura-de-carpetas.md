# Estructura de carpetas

> Actualizado tras la etapa 1 · Confianza: **[Verificado]** (`git ls-files`).

```
barstock/
├── AGENTS.md · CLAUDE.md          # Guías para agentes (raíz)
├── README.md                      # Estado real, puesta en marcha y mapa
├── docs/                          # ESTA documentación
├── proxy.ts                       # Sesión + guarda de rutas y de roles
├── next.config.ts                 # Validación de entorno + headers de seguridad
├── app/
│   ├── layout.tsx · page.tsx · globals.css
│   ├── (auth)/                    # login, forgot-password, reset-password (públicas / con sesión de enlace)
│   ├── (dashboard)/               # layout servidor + 13 páginas: dashboard, pos, products, categories, inventory,
│   │                              #   orders(+[id]), customers(+[id]), suppliers, reports, settings, users
│   ├── auth/confirm/route.ts      # Canjea el token del correo (verifyOtp) y crea la sesión
│   └── api/v1/**/route.ts         # 25 Route Handlers, todos con route()/publicRoute()
├── components/
│   ├── app-shell.tsx              # Navegación filtrada por rol, menú de usuario, logout
│   ├── session-provider.tsx       # useSession() y useMoney()
│   ├── confirm-dialog.tsx · form-fields.tsx · pagination.tsx · query-error.tsx · page-spinner.tsx
│   ├── theme-provider.tsx
│   └── ui/                        # shadcn (17 componentes)
├── hooks/                         # useApiQuery, useDebouncedValue, useHydrated
├── lib/
│   ├── server/                    # SOLO servidor (import 'server-only'): http (route), auth, errors, supabase, supabase-admin,
│   │   └── services/              #   y un servicio por recurso
│   ├── validation/                # zod compartido: common, resources, reports
│   ├── api/                       # cliente fetch del navegador + un módulo por recurso
│   ├── env/                       # zod del entorno: schema, client, server
│   ├── auth/roles.ts · money.ts · dates.ts · cart-preview.ts · utils.ts
├── stores/cart.ts                 # Único store: ids y cantidades del carrito
├── types/                         # database.ts (GENERADO) · index.ts (derivado)
├── supabase/
│   ├── config.toml                # Auth cerrada, plantillas de correo, puertos
│   ├── migrations/                # baseline + integridad + roles/RLS + RPC + reportes
│   ├── templates/                 # Correos de invitación y recuperación
│   ├── seed.sql                   # Datos de ejemplo (sin usuarios)
│   └── legacy/                    # SQL histórico, NO ejecutar
├── test/                          # helpers, integration/, components/, setup.ts
├── e2e/ · playwright.config.ts    # Playwright (*.e2e.ts)
├── scripts/coverage-check.ts      # Umbral de cobertura fusionando los informes
├── .github/                       # ci.yml y dependabot.yml
├── package.json · bun.lock · bunfig.toml · .nvmrc · .env.example
└── tsconfig.json · eslint.config.mjs · .prettierrc.json · postcss.config.mjs · components.json
```

Los tests unitarios viven junto al código (`*.test.ts` en `lib/`, `stores/`).

## Responsabilidad por carpeta

| Carpeta | Contiene | Reglas |
|---|---|---|
| `app/(auth)`, `app/(dashboard)` | Páginas: composición e interacción | **No** importan `@supabase/*`, `@/lib/supabase` ni `@/lib/server` (lint). Solo `lib/api/*` |
| `app/api/v1` | Route Handlers finos: `route({ role, body, query, params, handler })` | Sin lógica: delegan en un servicio |
| `lib/server` | Servicios, autenticación, errores, clientes Supabase | Solo servidor; nunca importable desde UI |
| `lib/validation` | Esquemas zod compartidos | Solo columnas escribibles; sin `.default()` (rompe `PATCH`); `''` → `null` |
| `lib/api` | Cliente tipado del navegador | Un módulo por recurso |
| `components/ui` | Primitivas shadcn | Sin lógica; excluidas de Prettier (estilo upstream) |
| `supabase/migrations` | SQL versionado | No editar una migración ya aplicada fuera de local |
| `types/database.ts` | Generado (`bun run db:types`) | No editar a mano; se regenera tras cada migración |

## Código sin uso

| Elemento | Estado |
|---|---|
| `components/ui/tabs.tsx` | 0 importaciones (shadcn lo trajo; borrar o usar) |
| `public/*.svg` (5) | Restos de `create-next-app`, sin referencias |
| `purchase_orders`, `purchase_order_items`, `product_variants` | Solo esquema: sin API ni UI (etapa 2). Los gastos ya tienen API y pantalla: [gastos](../03-modulos/gastos.md) |
| `receipt_template` (ajustes) | Se guarda y se edita, pero nadie imprime un recibo con él |

## Convenciones de ubicación para código nuevo

Ver [convenciones-de-codigo.md](../05-guias/convenciones-de-codigo.md) y "Cómo añadir un recurso" en [API](08-api.md).
