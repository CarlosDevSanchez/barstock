# Datos semilla y migraciones

> Base: commit `54962b9` · Confianza: **[Verificado]** contra los archivos SQL.

## Orden de ejecución correcto

Los scripts se ejecutan a mano en el **SQL Editor de Supabase**, en este orden:

1. `supabase/schema.sql` — tipos, tablas, índices, RLS restrictiva, funciones y triggers.
2. `supabase/fix_rls_policies.sql` — parche que abre RLS a cualquier usuario autenticado
   (**necesario hoy para que el POS funcione**; el README no lo menciona). **No es idempotente.**
3. `supabase/seed.sql` — datos de ejemplo (opcional). **No es idempotente** (sin `ON CONFLICT`).

> Advertencia: el paso 2 es el que crea el problema de seguridad [C1](../04-auditoria/hallazgos/C1-rls-permisivo.md).
> Cuando se reemplace por políticas por rol, este orden cambia; ver
> [plan de remediación](../06-roadmap/plan-de-remediacion.md).

## Contenido del seed (`seed.sql`, 62 líneas)

| Tabla | Filas | Detalle |
|---|---|---|
| `settings` | 8 | `store_name`, `store_address`, `store_phone`, `store_email`, `tax_rate` (`0.10`), `currency` (`"USD"`), `low_stock_threshold` (`10`), `receipt_template` (objeto con `header`/`footer`). Los strings se insertan como JSON (`'"..."'`). |
| `categories` | 5 | Electronics, Clothing, Food & Beverages, Home & Garden, Sports & Outdoors (ids `1111…` a `5555…`) |
| `products` | 6 | Wireless Mouse `ELEC-001` (29,99), USB-C Cable `ELEC-002` (12,99), T-Shirt `CLTH-001` (19,99), Coffee Beans `FOOD-001` (24,99, **tax 0.05**), Water Bottle `HOME-001` (29,99), Yoga Mat `SPRT-001` (39,99). Resto con tax `0.10` |
| `product_variants` | 6 | Solo para T-Shirt: Small/Medium/Large (size) y Red/Blue/Black (color) |
| `inventory` | 5 | Mouse 50/10, USB-C 100/20, Coffee 30/10, Bottle 25/5, Yoga 15/5 — todas con `variant_id NULL` |
| `suppliers` | 3 | Tech Supplies Inc, Fashion Wholesale, Food Distributors |
| `customers` | 3 | Alice, Bob, Carol, con `loyalty_points` y `total_spent` **fijados a mano** (450, 600, 225) |

Ids fijos y legibles (`aaaaaaaa-…`, `8888…`, `9999…`) para poder referenciarlos entre inserts.

### Efectos del seed sobre el comportamiento de la app

- **T-Shirt no tiene fila de inventario** ni sus variantes: vender una camiseta no descuenta nada y no
  aparece en `/inventory`. Además el POS no permite elegir variante.
- El seed no crea usuarios ni perfiles: el primer acceso requiere registrarse en `/register` (y, si el
  proyecto exige confirmar email, verificarlo).
- Los `total_spent`/`loyalty_points` sembrados **no corresponden a ninguna orden**: las ventas reales no los
  actualizan, así que "Top customers" mostrará estas cifras artificiales hasta que se implemente el cálculo.
- El `tax_rate` global (`settings.tax_rate = 0.10`) no lo lee ningún código; el POS usa `0.1` fijo.

## Migraciones: estado actual

**No existe un sistema de migraciones.** No hay `supabase/migrations/`, ni `config.toml`, ni CLI configurada,
ni pipeline. El estado de la base es "lo que se haya pegado en el SQL Editor", lo que implica:

| Riesgo | Detalle |
|---|---|
| No reproducible | No se puede recrear el entorno con un comando ni garantizar que dev = prod |
| Sin historial | No se sabe qué cambios se aplicaron ni cuándo (`fix_rls_policies.sql` es el único vestigio) |
| Sin reversión | No hay `down` ni scripts de rollback |
| Políticas contradictorias | Las de `schema.sql` y las del parche coexisten y se solapan |
| Sin CI | Nada valida el SQL antes de aplicarlo |

## Procedimiento recomendado

1. Instalar Supabase CLI y `supabase init`; enlazar con `supabase link --project-ref <ref>`.
2. Capturar el estado actual: `supabase db pull` → genera la primera migración con el esquema real
   (incluye el efecto del parche).
3. A partir de ahí, **todo cambio** va en un archivo nuevo `supabase/migrations/<timestamp>_<tema>.sql`
   (`supabase migration new <tema>`), revisado en PR y aplicado con `supabase db push`.
4. Mover `seed.sql` a `supabase/seed.sql` estándar (se ejecuta con `supabase db reset` en local).
5. Generar tipos con `supabase gen types typescript --linked > types/database.ts` y sustituir el
   `types/index.ts` manual gradualmente.
6. Cada migración destructiva o de datos debe llevar comentario de reversión y prueba en un proyecto de staging.

## Backups y recuperación [Por verificar]

Nada del repositorio documenta backups, RPO/RTO ni procedimientos de restauración. Supabase ofrece
copias automáticas y *Point-in-Time Recovery* según el plan contratado. Pendiente:

- [ ] Confirmar plan y frecuencia de backups del proyecto.
- [ ] Decidir RPO/RTO aceptables para un POS (¿cuánta venta se puede perder?).
- [ ] Probar una restauración en un proyecto de staging y documentar el resultado.
- [ ] Definir retención y quién ejecuta la recuperación (runbook).
