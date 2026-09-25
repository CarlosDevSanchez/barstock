# Módulo: Cuentas por cobrar

> Nuevo en la fase E · `app/(dashboard)/receivables/page.tsx` · API `GET /receivables`, `POST /tabs/{id}/defer`, `POST /receivables/{id}/payments`, `PATCH /receivables/{id}`, `POST /receivables/{id}/write-off` · Migraciones `20261005000002_order_status_written_off.sql` + `20261005000003_receivables.sql` · Confianza: **[Verificado]** (`test/integration/receivables.test.ts`, UI `/receivables` y tarjeta del dashboard en local).

Una cuenta abierta con cliente puede **cerrarse como pendiente** (`defer_tab`): el stock ya bajó al añadir ítems, se crea una orden `pending` con el saldo restante y la cuenta (`tab`) queda `closed`. El ingreso **no** cuenta en reportes hasta que el saldo se paga por completo (`pay_receivable` → `completed` + `settled_at`).

## Quién

| Acción | Rol |
|---|---|
| Listar / diferir / registrar pago | cajero+ |
| Editar vencimiento / recordatorio | gerente+ |
| Castigar (`written_off`) | admin |

## Columnas en `orders`

`settled_at`, `due_date`, `reminder_enabled`, `reminder_note`, `written_off_at`, `written_off_by`, `write_off_reason`. Estado nuevo: `written_off` (enum en migración aparte: Postgres no deja usarlo en la misma transacción que lo crea).

Backfill: órdenes `completed`/`refunded` existentes reciben `settled_at = coalesce(occurred_at, created_at)`.

## RPC

| RPC | Qué hace |
|---|---|
| `_create_order_from_tab(tab_id, status)` | Interna. Extrae el cuerpo de `_close_tab`. Si `completed`, pone `settled_at = now()`; si `pending`, lo deja null. Copia ítems, pagos parciales de la tab y cierra la tab. |
| `_close_tab` | Wrapper → `_create_order_from_tab(..., 'completed')` |
| `defer_tab` | Tab abierta, con `customer_id`, balance > 0. Crea orden `pending` y guarda vencimiento/recordatorio/nota. |
| `pay_receivable` | 1–2 pagos (`method`/`amount`, métodos distintos). `FOR UPDATE` de la orden. Suma ≤ saldo. Idempotencia como `create_sale`. Al llegar a 0: `completed`, `settled_at = now()`, `business_day_id` de la asignación actual. |
| `update_receivable` | Solo `pending`. |
| `write_off_receivable` | Solo `pending` → `written_off`. **No** pone `settled_at`. |
| `list_receivables` | Filas con saldo, `days_overdue`, etc. `p_status` null = pending + written_off. |
| `refund_order` | Rechaza `pending` con `P0001` antes del chequeo genérico. |

`create_sale` ahora escribe `settled_at = coalesce(occurred_at, now())`.

## Reportes y dashboard

- `sales_report` / `dashboard_summary` agrupan y filtran por **`settled_at`** (no por `occurred_at`/`created_at`).
- Dashboard: `receivables_total`, `receivables_overdue`.
- Reportes: `written_off_total`; `net_profit` resta también ese monto.
- `business_day_report` sigue anclado a `business_day_id` de órdenes `completed` (al cobrar del todo, `pay_receivable` reescribe ese id).

## UI

- POS: «Cerrar como cuenta por cobrar» solo si la tab tiene cliente.
- `/receivables`: lista, pago (1–2 métodos), editar (gerente), castigar (admin).
- Cliente: bloque «Saldo pendiente».
- Ticket: línea «PENDIENTE DE PAGO» si `status = pending`.
- Dashboard: tarjeta «Por cobrar».

Relacionados: [Cuentas abiertas](cuentas-abiertas.md), [Reportes](reportes.md), [Dashboard](dashboard.md), [Caja y jornada](caja-y-jornada.md).
