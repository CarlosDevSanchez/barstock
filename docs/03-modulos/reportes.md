# Módulo: Reportes

> Actualizado fase E · `app/(dashboard)/reports/page.tsx` · API `GET /reports?from&to` · RPC `sales_report` · Confianza: **[Por verificar]** (cambio a `settled_at` + `written_off_total`).

- **Quién:** gerente y admin (`403` al cajero; `proxy.ts` lo redirige).
- **Rango:** dos fechas (`YYYY-MM-DD`), por defecto los últimos 7 días **en la zona de Ajustes**. Máximo **366 días** (`422` si se supera o si `from > to`).

## Contenido
| Sección | Definición |
|---|---|
| Ingresos, órdenes, ticket medio, impuestos, descuentos | Sobre órdenes `completed` del rango. **Ingreso = lo cobrado** (`orders.total`), nunca `qty × selling_price` de lista |
| Descuento de promociones (`promo_markdown`) | Σ `(lista actual × qty) − (unit_price asignado × qty − discount de línea)` solo en líneas con `promotion_id`. **No** entra en `total_discount` (ese es el descuento global de la orden) |
| COGS (`total_cogs`) | Σ `qty × coalesce(order_items.unit_cost, products.cost_price)`. Las ventas nuevas guardan el costo al cobrar; las anteriores usan el costo de catálogo actual |
| Utilidad bruta (`gross_profit`) | Σ bases de línea (`unit_price × qty − discount`) − `total_cogs` (sin impuesto) |
| Gastos (`total_expenses`) | Σ `expenses.amount` del rango (`occurred_at`, sin anulados), con desglose `expenses_by_category` |
| Castigos (`written_off_total`) | Σ saldo restante de órdenes `written_off` cuyo `written_off_at` cae en el rango. **Solo informativo: no se resta de `net_profit`** ([H6](../04-auditoria/hallazgos/H6-revision-adversarial-a-f.md), C1) |
| Ganancia neta (`net_profit`) | `gross_profit + (pagos cobrados sobre órdenes written_off, en su propia fecha de cobro) − total_discount − total_expenses − (costo de los productos de las órdenes written_off del rango)`. Antes se restaba el saldo entero de `written_off_total` sin cargar su costo ni sumar lo ya cobrado; ver [H6](../04-auditoria/hallazgos/H6-revision-adversarial-a-f.md) |
| Ventas diarias | Serie por día en la zona de Ajustes, con días vacíos a 0 |
| Top productos (10) | Por **ingresos de línea** (`Σ order_items.total`, incluye impuesto); también `cogs` y `gross_profit` por SKU. Promos cuentan como **componentes** a precio asignado |
| Top promociones (10) | Paquetes estimados (`min(qty/receta)` por orden), órdenes e ingresos de línea de combo |
| Top clientes (5) | Nº de órdenes y gasto (`Σ orders.total`) **dentro del rango** |
| Métodos de pago | Órdenes distintas y monto por método (`count(distinct order_id)`; un pago dividido no cuenta dos veces el mismo método) |

## Reglas
- **Se excluyen los reembolsos** y las órdenes `pending` / `written_off` del ingreso.
- Agregación **en SQL**; el navegador solo pinta.
- Los límites del rango se calculan como `[00:00 del día inicial, 00:00 del día siguiente al final)` en la zona de Ajustes, sobre **`orders.settled_at`**: una cuenta diferida cuenta el día en que se cobra el saldo, no el día del diferimiento. Una venta offline sigue usando `settled_at = coalesce(occurred_at, now())` al crear la orden.
- Un combo a 17 000 con lista 20 000 aporta **17 000** (+ impuesto) a ingresos y ~**3 000** a `promo_markdown`, no 20 000 de lista. Ver [promociones](promociones.md) y [D-margin](../06-roadmap/decisiones-pendientes.md).

## Límites conocidos
- Sin exportación (CSV/PDF), sin comparativas.
- Ingreso por producto incluye impuesto: la utilidad bruta usa la **base** sin impuesto.
- El markdown de promo usa el **precio de lista actual**. El COGS de una venta nueva usa el costo fotografiado; el de una línea antigua (sin `unit_cost`) sigue el catálogo actual.
- El dashboard del cajero **no** muestra COGS/utilidad (solo `/reports`, gerente+).
- `business_day_report` también devuelve `total_expenses`, `expenses_by_category` y `net_profit`. La pantalla «Por jornada» todavía no los pinta: el esquema que valida esa respuesta vive en `lib/validation/cash.ts` y esta fase no lo amplía.

## Por jornada

El selector «Por fechas / Por jornada» no cambia `sales_report`. «Por jornada» llama a `business_day_report` (gerente+): órdenes `completed` de esa jornada (`business_day_id`; al liquidar una cuenta por cobrar, `pay_receivable` asigna la jornada del cobro), pagos por método, cajas con diferencia y cuántas ventas quedaron sin caja. El fondo de caja no entra en el ingreso. Ver [caja y jornada](caja-y-jornada.md).

Relacionados: [Dashboard](dashboard.md), [Cuentas por cobrar](cuentas-por-cobrar.md), [Promociones](promociones.md), [Ajustes](ajustes.md), [Caja y jornada](caja-y-jornada.md).
