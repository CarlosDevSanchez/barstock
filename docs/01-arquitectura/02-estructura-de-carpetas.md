# Estructura de carpetas

> Base: commit `54962b9` · 61 archivos versionados · Confianza: **[Verificado]**

```
barstock/
├── AGENTS.md                  # Guía para agentes de IA (raíz)
├── CLAUDE.md                  # Instrucciones específicas de Claude Code (raíz)
├── README.md                  # README original (parcialmente inexacto: ver auditoría)
├── docs/                      # ESTA documentación
├── app/                       # Rutas (App Router)
│   ├── layout.tsx             # Layout raíz: fuentes Geist, ThemeProvider, Toaster (44 líneas)
│   ├── page.tsx               # redirect('/login')
│   ├── globals.css            # Tailwind 4 + tokens de tema shadcn
│   ├── favicon.ico
│   ├── (auth)/                # Rutas públicas
│   │   ├── login/page.tsx            (113)
│   │   ├── register/page.tsx         (162)
│   │   └── forgot-password/page.tsx  (112)
│   └── (dashboard)/           # Rutas con sidebar
│       ├── layout.tsx                (222)  Guarda de sesión + navegación
│       ├── dashboard/page.tsx        (277)
│       ├── pos/page.tsx              (419)  ← archivo más grande y más crítico
│       ├── products/page.tsx         (332)
│       ├── categories/page.tsx       (242)
│       ├── inventory/page.tsx        (137)
│       ├── orders/page.tsx           (121)
│       ├── orders/[id]/page.tsx      (252)
│       ├── customers/page.tsx        (186)
│       ├── customers/[id]/page.tsx   (208)
│       ├── suppliers/page.tsx        (172)
│       ├── reports/page.tsx          (308)
│       └── settings/page.tsx         (123)
├── components/
│   ├── theme-provider.tsx     # Wrapper de next-themes (11)
│   └── ui/                    # shadcn/ui: 16 componentes (ver "Código sin uso")
├── lib/
│   ├── supabase/client.ts     # Único cliente Supabase, singleton de módulo (6)
│   ├── utils.ts               # cn() = clsx + tailwind-merge (6)
│   └── constants.ts           # Constantes de dominio (35) — SIN IMPORTS
├── stores/                    # Zustand
│   ├── auth.ts                # Perfil del usuario y helpers de rol (25)
│   ├── cart.ts                # Carrito del POS, persistido (109)
│   └── settings.ts            # Ajustes de tienda, persistido (37) — SIN IMPORTS
├── types/index.ts             # Tipos manuales del esquema (214)
├── supabase/
│   ├── schema.sql             # Esquema completo (392)
│   ├── fix_rls_policies.sql   # Parche de RLS, se ejecuta DESPUÉS del schema (82)
│   └── seed.sql               # Datos de ejemplo (62)
├── public/                    # 5 SVG del scaffold de create-next-app, sin uso
├── components.json            # Configuración de shadcn
├── eslint.config.mjs          # ESLint 9 flat config (next core-web-vitals + typescript)
├── next.config.ts             # Vacío
├── postcss.config.mjs         # @tailwindcss/postcss
├── tsconfig.json              # strict, alias @/* → ./*
├── package.json / bun.lock / bunfig.toml
└── .claude/settings.local.json  # Habilita el MCP `code-review-graph`
```

## Responsabilidad por carpeta

| Carpeta | Debe contener | Hoy contiene |
|---|---|---|
| `app/` | Rutas y su composición | Rutas **y** toda la lógica de datos y de negocio (páginas de 120–420 líneas) |
| `components/ui/` | Primitivas shadcn sin lógica | Correcto |
| `components/` (resto) | Componentes de dominio reutilizables | Solo `theme-provider`. **No existe** `components/layout/` aunque el README lo lista |
| `lib/` | Utilidades y clientes | Cliente Supabase, `cn`, constantes sin uso |
| `stores/` | Estado global de cliente | 3 stores |
| `types/` | Contratos de datos | Un solo archivo escrito a mano, sin generación desde el esquema |
| `supabase/` | SQL | 3 scripts sueltos, sin carpeta `migrations/` |

## Código sin uso [Verificado]

| Elemento | Evidencia | Acción sugerida |
|---|---|---|
| `lib/constants.ts` | Ningún archivo lo importa | Usarlo (`ROLES`, `ORDER_STATUS`, `TAX_RATE_DEFAULT`) o borrarlo |
| `stores/settings.ts` | Ningún archivo lo importa; `/settings` usa `useState` local | Conectar a la tabla `settings` o borrar |
| `components/ui/form.tsx`, `components/ui/tabs.tsx` | 0 importaciones | Borrar, o usar `form.tsx` al introducir validación |
| `zod`, `react-hook-form`, `@hookform/resolvers` | 0 importaciones | Usarlas en [H2](../04-auditoria/hallazgos/H2-sin-validacion.md) |
| `public/*.svg` (5) | 0 referencias | Borrar |
| `useAuthStore.isAdmin / isManager / canManageProducts` | Solo se definen; nunca se llaman | Usarlos para gatear UI (además de RLS) |
| Imports muertos | ESLint reporta 10 warnings | `eslint --fix` |

## Duplicación notable

- `app/(dashboard)/layout.tsx:86-213` repite el markup de navegación y el menú de usuario **dos veces**
  (sidebar de escritorio y drawer móvil). Candidatos a `<SidebarNav>` y `<UserMenu>`.
- El spinner de carga (`animate-spin … border-emerald-600`) está copiado en 5 archivos
  (`layout.tsx`, `dashboard`, `reports`, `orders/[id]`, `customers/[id]`).
- Cada página reimplementa: `useState` de lista + `useState` de búsqueda + `fetchX()` + filtro en cliente.
- La lógica de "precio efectivo" `item.variant?.selling_price ?? item.product.selling_price`
  aparece 4 veces entre `cart.ts` y `pos/page.tsx`.

## Convenciones de ubicación para código nuevo

Ver [convenciones-de-codigo.md](../05-guias/convenciones-de-codigo.md). Resumen: lógica de datos en
`lib/data/<recurso>.ts`, esquemas zod en `lib/validation/`, componentes de dominio en
`components/<dominio>/`, SQL versionado en `supabase/migrations/`.
