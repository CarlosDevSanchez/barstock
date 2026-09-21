# Módulo: Ajustes

> Archivo: `app/(dashboard)/settings/page.tsx` (123 líneas) · Base: commit `54962b9`

## Estado: **decorativo — no persiste nada**

`handleSave` solo ejecuta `toast.success('Settings saved successfully!')` (`:23-25`). No escribe en la
tabla `settings`, ni en `useSettingsStore`, ni en `localStorage`. Al recargar, los valores vuelven a los
predeterminados hardcodeados.

## Campos (estado local con `useState`)

| Campo | Valor inicial | Unidad / nota |
|---|---|---|
| `storeName` | `POS Inventory System` | |
| `storeAddress` | `123 Main Street, City, Country` | dato de ejemplo |
| `storePhone` | `+1234567890` | dato de ejemplo |
| `storeEmail` | `info@posystem.com` | dato de ejemplo |
| `taxRate` | `'10'` | **Porcentaje** (10). El carrito usa **fracción** (`0.1`); `products.tax_rate` también es fracción |
| `currency` | `USD` | Opciones USD/EUR/GBP; la UI muestra `$` fijo sin importar la selección |
| `lowStockThreshold` | `'10'` | El dashboard usa 10 fijo; el inventario usa el umbral por fila |

## Tres fuentes de "ajustes" desconectadas

| Fuente | Dónde | ¿La lee alguien? |
|---|---|---|
| Tabla `settings` (seed: 8 claves) | Supabase | **No** |
| `useSettingsStore` (`stores/settings.ts`) | `localStorage['pos-settings']` | **No** (0 importaciones) |
| Estado local de `/settings` | Memoria de la página | Solo esta página |

Y los valores realmente efectivos están **hardcodeados**: tasa `0.1` en `stores/cart.ts:30` y
`products/page.tsx`, umbral `10` en `dashboard/page.tsx:63`, nombre "POS System" en `layout.tsx`,
moneda `$` en todo el JSX. `lib/constants.ts` define `TAX_RATE_DEFAULT`, `CURRENCY`, `APP_NAME`,
sin uso.

## Riesgos

- Un usuario cree que cambió la tasa de impuesto o el umbral y **no tiene ningún efecto**.
- Cualquier usuario autenticado accede a la pantalla (sin gating por rol) y, por RLS, podría escribir `settings` por API.

## Diseño objetivo

1. Una sola fuente de verdad: la tabla `settings` (clave/valor JSONB, ya existe), con RLS solo-admin para escribir.
2. Lectura al iniciar sesión, cacheada en un provider/store **no persistente** (o con revalidación).
3. Consumidores: tasa por defecto, umbral de bajo stock, moneda/formatos, cabecera y pie del recibo (`receipt_template`).
4. Validación con zod (porcentaje 0–100, moneda de una lista, umbral entero ≥ 0).
5. Decidir unidad única para tasas (fracción recomendada) — ver [decisiones-pendientes](../06-roadmap/decisiones-pendientes.md).
