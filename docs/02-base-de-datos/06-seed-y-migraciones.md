# Datos semilla y migraciones

> Actualizado en la etapa 1 (Pasos 3–4). Confianza: **[Verificado]** (`supabase db reset` aplica todo sin errores).

## Migraciones versionadas

`supabase/migrations/` (Supabase CLI, `supabase/config.toml`). Una migración por tema, aplicadas en orden por timestamp:

| Migración | Contenido |
|---|---|
| `20260921000001_baseline.sql` | El antiguo `schema.sql` tal cual (tablas, tipos, índices, RLS y triggers originales) |
| `…02_integrity.sql` | `CHECK` de cantidades/precios/importes, `NOT NULL` en FKs de pertenencia y timestamps, índice único parcial de inventario sin variante, índices nuevos, `tax_rate` → `NUMERIC(6,4)`, `profiles.is_active`, `products.deleted_at`, `profiles.id ON DELETE CASCADE` |
| `…03_roles_rls.sql` | Roles, políticas por rol, protección de `profiles`, alta cerrada, revocación de escrituras directas ([RLS](03-rls-y-politicas.md)) |
| `…04_business_rpc.sql` | `create_sale`, `refund_order`, `adjust_inventory`, secuencia de órdenes, inventario automático, totales de clientes derivados |
| `…05_reporting.sql` | `dashboard_summary`, `sales_report` |
| `…06_locale_and_money.sql` | `profiles.locale`; `currency_decimals` / `money_scale`; columnas de dinero → `NUMERIC(14,2)`; `create_sale` con redondeo según la moneda de la tienda |
| `…07_top_products.sql` | `top_selling_products` (RPC `SECURITY DEFINER`, panel de venta rápida del POS) |
| `…08_tabs.sql` | `tabs`, `tab_members`, `tab_items`, `tab_payments`, `orders.tab_id`, enum `tab_status`, RLS y sus RPC ([cuentas-abiertas](../03-modulos/cuentas-abiertas.md)) |

`supabase/legacy/` conserva `schema.sql` y `fix_rls_policies.sql` como historia (**no ejecutar**). `fix_rls_policies.sql` no se migra: `…03`
elimina todas las políticas existentes, incluidas las que ese parche haya creado en una base ya desplegada.

### Flujo de trabajo

```bash
bun run db:start                 # supabase start (requiere Docker); aplica migraciones y seed
bun run db:reset                 # recrea la BD local desde cero (migraciones + seed)
bun run db:types                 # regenera types/database.ts (hacerlo tras cada migración)
supabase migration new <tema>    # nueva migración con timestamp
```

Reglas: **nunca editar una migración ya aplicada** en un entorno compartido (crear otra). Editarlas solo mientras nada las haya aplicado
fuera de local. Cada cambio de esquema/RLS: migración + prueba + actualizar `docs/` + `db:types`.

### Aplicar a una base existente (producción): paso controlado y aparte

1. Backup.
2. Ejecutar las consultas de integridad de [verificar-checkout](../05-guias/verificar-checkout.md) (0 huérfanas, 0 stock negativo): los
   `CHECK` simples fallarán si hay filas inválidas. Los dos `CHECK` aritméticos (`orders_total_matches`, `order_items_total_matches`) se
   crean `NOT VALID` para no bloquear con órdenes antiguas; ejecutar `VALIDATE CONSTRAINT` tras depurar los datos.
3. `supabase db pull` en un proyecto de staging para comparar con la baseline (el estado real puede diferir de `schema.sql`).
4. Promover al primer admin y **crear los usuarios por invitación antes de cerrar el signup** ([RLS](03-rls-y-politicas.md#migrar-una-base-ya-desplegada)).
5. El backfill de `…04` crea filas de inventario con cantidad **0** para los productos que no tenían: hay que ajustarlas con `adjust_inventory`.
   Además **sustituye** `customers.total_spent`/`loyalty_points` por los derivados de las órdenes `completed`.

## Seed (`supabase/seed.sql`)

Se ejecuta automáticamente tras las migraciones en `supabase start`/`db reset` (`[db.seed]` de `config.toml`). No es idempotente (solo para BD vacías).

| Tabla | Filas | Detalle |
|---|---|---|
| `settings` | 9 | `store_name`, `store_address`, `store_phone`, `store_email`, `tax_rate` (`0.19`, IVA general CO — supuesto D3), `currency` (`"COP"`), **`timezone` (`"America/Bogota"`)**, `low_stock_threshold` (`10`), `receipt_template` |
| `categories` | 5 | Electronics, Clothing, Food & Beverages, Home & Garden, Sports & Outdoors |
| `products` | 6 | Wireless Mouse `ELEC-001`, USB-C Cable `ELEC-002`, T-Shirt `CLTH-001`, Coffee Beans `FOOD-001` (tax `0.05`), Water Bottle `HOME-001`, Yoga Mat `SPRT-001` |
| `product_variants` | 6 | Solo T-Shirt (Small/Medium/Large, Red/Blue/Black); no se venden desde el POS |
| `inventory` | 6 | Las filas las crea el trigger al insertar cada producto; el seed **actualiza** cantidades: Mouse 50/10, USB-C 100/20, T-Shirt 60/10, Coffee 30/10, Bottle 25/5, Yoga 15/5 |
| `suppliers` | 3 | Tech Supplies Inc, Fashion Wholesale, Food Distributors |
| `customers` | 3 | Alice, Bob, Carol. `total_spent`/`loyalty_points` **ya no se siembran**: los calcula el trigger a partir de órdenes |

El seed **no crea usuarios**. Para desarrollo local, crear un admin con la API de administración de Auth (el trigger asigna rol y activa
el perfil cuando `app_metadata.role` cambia):

```bash
curl -s -X POST "$API_URL/auth/v1/admin/users" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local.dev","password":"a-long-local-password","email_confirm":true,"app_metadata":{"role":"admin"}}'
```

(`supabase status -o env` imprime `API_URL` y `SERVICE_ROLE_KEY`.) Los usuarios de las pruebas automáticas se crean igual, en su `setup`.

## Configuración de Auth local (`supabase/config.toml`)

`enable_signup = false` (alta solo por invitación), `[auth.email] enable_confirmations = true`, `minimum_password_length = 10`,
`site_url = http://localhost:3000`. Los correos de invitación y de restablecer contraseña llegan a Mailpit: <http://127.0.0.1:54324>.
