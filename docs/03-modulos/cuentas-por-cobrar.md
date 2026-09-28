# Módulo: Cuentas por cobrar

> Nuevo en la fase E · `app/(dashboard)/receivables/page.tsx` · API `GET /receivables`, `POST /tabs/{id}/defer`, `POST /receivables/{id}/payments`, `PATCH /receivables/{id}`, `POST /receivables/{id}/write-off` · Migraciones `20261005000002_order_status_written_off.sql` + `20261005000003_receivables.sql` + `20261008000001_defer_tab_v2.sql` · Confianza: **[Verificado]** (`test/integration/receivables.test.ts`, UI `/receivables` y tarjeta del dashboard en local).

Una cuenta abierta puede **cerrarse como pendiente** (`defer_tab`): hace falta un cliente (el de la tab, uno elegido al diferir) o un nombre libre (`orders.debtor_name`). El stock ya bajó al añadir ítems; se crea una orden `pending` con el saldo restante y la cuenta (`tab`) queda `closed`. Se puede registrar un abono inicial (1–2 métodos, suma **estrictamente menor** que el saldo) en la misma transacción. El ingreso **no** cuenta en reportes hasta que el saldo se paga por completo (`pay_receivable` → `completed` + `settled_at`).

## Quién

| Acción | Rol |
|---|---|
| Listar / diferir / registrar pago | cajero+ |
| Editar vencimiento / recordatorio | gerente+ |
| Castigar (`written_off`) | admin |

## Columnas en `orders`

`settled_at`, `due_date`, `reminder_enabled`, `reminder_note`, `debtor_name`, `written_off_at`, `written_off_by`, `write_off_reason`. Una `pending` exige `customer_id` o `debtor_name`. Estado nuevo: `written_off` (enum en migración aparte: Postgres no deja usarlo en la misma transacción que lo crea).

Backfill: órdenes `completed`/`refunded` existentes reciben `settled_at = coalesce(occurred_at, created_at)`.

## RPC

| RPC | Qué hace |
|---|---|
| `_create_order_from_tab(tab_id, status, debtor_name?)` | Interna. Extrae el cuerpo de `_close_tab`. Si `completed`, pone `settled_at = now()`; si `pending`, lo deja null. Copia ítems, pagos parciales de la tab y cierra la tab. `p_debtor_name` entra en el INSERT (un CHECK de Postgres no puede ser DEFERRABLE, así que no se puede rellenar `debtor_name` después). |
| `_close_tab` | Wrapper → `_create_order_from_tab(..., 'completed')` |
| `defer_tab` | Tab abierta, balance > 0. Deudor: `p_customer_id` (activo), el `customer_id` de la tab, o `p_debtor_name` (2–120). Abono inicial opcional (1–2 métodos, suma < saldo) se escribe en `tab_payments` y `_create_order_from_tab` lo copia. `Idempotency-Key` **obligatoria** en `POST /tabs/{id}/defer`. |
| `pay_receivable` | 1–2 pagos (`method`/`amount`, métodos distintos). `FOR UPDATE` de la orden. Suma ≤ saldo. Idempotencia como `create_sale`, pero la cabecera `Idempotency-Key` es **obligatoria** en `POST /receivables/{id}/payments` (400 si falta) — un cobro nunca debe poder reintentarse sin ella. Al llegar a 0: `completed`, `settled_at = now()`; `business_day_id` se actualiza con la jornada activa **solo si hay una abierta**, si no conserva el que ya tenía (no se pierde el vínculo con la jornada donde se difirió). |
| `update_receivable` | Solo `pending`. |
| `write_off_receivable` | Solo `pending` → `written_off`. **No** pone `settled_at`. |
| `list_receivables` | Filas con saldo, `days_overdue`, `reminder_note`, `debtor_name`, `customer_id`. `customer_name` = `coalesce(cliente, debtor_name)`. `p_q` busca por ese nombre. `p_status` acepta **solo** `null` (pending + written_off), `'pending'` o `'written_off'`. `p_limit` 1–500 (default 200), orden por `due_date nulls last`. |
| `refund_order` | Rechaza `pending` con `P0001` antes del chequeo genérico. |

`create_sale` ahora escribe `settled_at = coalesce(occurred_at, now())`.

## Reportes y dashboard

- `sales_report` / `dashboard_summary` agrupan y filtran por **`settled_at`** (no por `occurred_at`/`created_at`).
- Dashboard: `receivables_total`, `receivables_overdue`.
- Reportes: `written_off_total` (saldo no cobrado, solo informativo); `net_profit` **no** lo resta — solo resta el costo de los productos de esas órdenes, y suma (sin impuesto) los pagos que sí se cobraron, en la fecha en que se cobraron.
- `business_day_report` cuenta una orden por su `business_day_id` cuando lo tiene; solo cae a `settled_at` cuando la orden no tiene `business_day_id` (para no contarla dos veces entre el reporte del día al que "pertenece" y el día en que se liquidó).

## UI

- POS: «Cerrar como cuenta por cobrar» si hay saldo (cliente opcional; se puede poner solo un nombre).
- `/receivables`: lista, pago (1–2 métodos), editar (gerente), castigar (admin).
  - Editar preserva `reminder_note` como valor inicial del diálogo (antes se perdía porque `list_receivables` no
    la devolvía).
  - El diálogo de abono es el mismo `PaymentDialog` del POS (`amountEditable`): el monto se puede bajar del
    saldo (abono parcial), un pago dividido no puede repetir método (la segunda fila excluye el primero) y, si
    hay efectivo, muestra recibido y cambio vía `cashDifference`.
- Cliente: bloque «Saldo pendiente».
- Ticket: línea «PENDIENTE DE PAGO» si `status = pending`.
- Dashboard: tarjeta «Por cobrar».

Relacionados: [Cuentas abiertas](cuentas-abiertas.md), [Reportes](reportes.md), [Dashboard](dashboard.md), [Caja y jornada](caja-y-jornada.md).
