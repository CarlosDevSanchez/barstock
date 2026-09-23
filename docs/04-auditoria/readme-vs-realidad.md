# README vs. realidad

> **Registro histórico.** Compara el `README.md` **original** (commit `54962b9`) con la realidad de entonces. El `README.md` actual se reescribió en la etapa 1 con el estado real; muchas de las discrepancias de abajo ya no existen.

> Comparación de `README.md` (raíz) con el código en el commit `54962b9`. Confianza: **[Verificado]** salvo indicación.
> Objetivo: que el README deje de afirmar capacidades inexistentes. Ver hallazgo [M12](hallazgos/medios-y-bajos.md) y [H4](hallazgos/H4-flujos-incompletos.md).

## Afirmaciones de funcionalidades

| El README dice | Realidad | Veredicto |
|---|---|---|
| "Built with **Next.js 14**" | `next@16.1.6` | ❌ Desactualizado |
| "Role-based access control (Admin, Manager, Cashier)" | Los roles existen en datos; **no restringen nada** (UI ni RLS efectiva) | ❌ Falso |
| "Protected routes with middleware" / "authentication middleware" | No hay `middleware.ts`/`proxy.ts`; guarda en un `useEffect` del cliente | ❌ Falso |
| "Login / Register / Forgot Password" | El flujo de recuperar contraseña termina en 404 (`/reset-password` no existe) | ⚠️ Parcial |
| "Select role: Admin, Manager, or Cashier" (registro) | El rol elegido se ignora; todos nacen `cashier` | ❌ Falso |
| "Email verification is required" | Depende de la configuración del proyecto Supabase | ❓ Por verificar |
| "Real-time revenue statistics" (dashboard) | Se calcula una vez al cargar; no hay realtime. KPI de bajo stock topado en 5 | ⚠️ Impreciso |
| "Order completion with inventory updates" / "Automatic stock updates on sales" | Actualiza desde el cliente, sin transacción; el filtro `eq('variant_id', null)` probablemente omite el descuento | ⚠️ Dudoso ([C2](hallazgos/C2-checkout-no-atomico.md)) |
| "Receipt printing support" | `window.print()` imprime la pantalla; en el POS tras vaciar el carrito | ⚠️ Parcial |
| "Product variants (size, color)" | Esquema y seed; **sin UI** ni venta de variantes | ❌ No implementado |
| "Transaction history logging" | Solo la venta escribe `inventory_transactions`; el reembolso no | ⚠️ Parcial |
| "Products automatically get inventory records" | No hay trigger ni código que lo haga | ❌ Falso |
| "Set custom low stock thresholds" | Sin UI para editar `low_stock_threshold` | ❌ No implementado |
| "Invoice generation (ready)" | No existe | ❌ No implementado |
| "Loyalty points tracking" / "Total spent tracking" | Columnas existentes; nada las actualiza | ❌ No funciona |
| "Purchase history (ready)" (clientes) | El detalle lista sus órdenes | ✅ Cierto |
| "Purchase order system (ready)" | Solo tablas; sin UI ni lógica | ❌ Solo esquema |
| "Profit analysis (ready)" | Utilidad bruta + COGS + markdown de promos en `/reports` (`sales_report`; costo/lista **actual**, sin snapshot) | ✅ Parcial (v1; no gastos operativos) |
| "Revenue charts" / "Sales analytics" | Gráficas en dashboard; reportes son listas de 7 días | ⚠️ Parcial |
| Settings: "Store information / Tax rate / Currency / Low stock threshold" | La pantalla no persiste nada | ❌ Decorativo |
| "Forms: React Hook Form + Zod (ready)" | Instaladas, **sin uso** | ❌ Sin uso |
| "Row Level Security (RLS) enabled on all tables" | Habilitada sí, pero con políticas que permiten todo a cualquier autenticado | ⚠️ Engañoso |
| "Secure password hashing via Supabase Auth" | Cierto (lo hace Supabase) | ✅ Cierto |
| "Realtime features (Ready for implementation)", "Keyboard shortcuts (Ready…)" | No implementados (el README lo reconoce como "ready for implementation") | ➖ Aspiracional |
| "Mobile / Tablet / Desktop responsive" | Layout con breakpoints; **[Inferido]**, no probado en dispositivos | ❓ Por verificar |
| "This is a fully-featured production-ready POS system" | Ver [auditoría](README.md) | ❌ Falso |
| "MIT License" | No existe archivo `LICENSE` | ⚠️ Sin archivo |
| "The system uses 14+ tables" | Son 15 tablas | ✅ Cierto |

## Instalación y estructura

| El README dice | Realidad |
|---|---|
| `cd "c:\Pos System"` | Ruta de Windows de otro entorno; el proyecto se llama `barstock` |
| `cp .env.local.example .env.local` | **No existe** `.env.local.example` (y `.gitignore` con `.env*` impediría versionarlo) |
| Pasos de Supabase: `schema.sql` y `seed.sql` | Falta `fix_rls_policies.sql`, **necesario** para que un cajero pueda vender con el esquema tal cual |
| Estructura: `components/layout/` | No existe |
| Estructura: `supabase/schema.sql`, `seed.sql` | Falta listar `fix_rls_policies.sql` |
| `npm run build` para desplegar | Falla sin variables de entorno ([H5](hallazgos/H5-build-sin-env.md)) |
| "Node.js 18+" | Next 16 exige Node `>=20.9.0` |
| "Contributing … production-ready" | No hay CONTRIBUTING; ver [convenciones](../05-guias/convenciones-de-codigo.md) |

## Acción propuesta

Reescribir el README con: descripción real, estado por módulo (esta carpeta), setup verificado
([setup-local](../05-guias/setup-local.md)), variables ([variables-de-entorno](../05-guias/variables-de-entorno.md)),
y enlace a `docs/`. Mover las listas de "ready" a un roadmap ([plan](../06-roadmap/plan-de-remediacion.md)).
