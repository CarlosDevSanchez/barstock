# Módulo: Reportes

> Actualizado 2026-09-22 · `app/(dashboard)/reports/page.tsx` · API `GET /reports?from&to` · RPC `sales_report` (márgenes + promos) · Confianza: **[Verificado]** en local (`admin.test.ts` + venta promo vs lista).

- **Quién:** gerente y admin (`403` al cajero; `proxy.ts` lo redirige).
- **Rango:** dos fechas (`YYYY-MM-DD`), por defecto los últimos 7 días **en la zona de Ajustes**. Máximo **366 días** (`422` si se supera o si `from > to`).

## Contenido
| Sección | Definición |
|---|---|
| Ingresos, órdenes, ticket medio, impuestos, descuentos | Sobre órdenes `completed` del rango. **Ingreso = lo cobrado** (`orders.total`), nunca `qty × selling_price` de lista |
| Descuento de promociones (`promo_markdown`) | Σ `(lista actual × qty) − (unit_price asignado × qty − discount de línea)` solo en líneas con `promotion_id`. **No** entra en `total_discount` (ese es el descuento global de la orden) |
| COGS (`total_cogs`) | Σ `qty × products.cost_price` **actual** (sin foto en la venta, v1) |
| Utilidad bruta (`gross_profit`) | Σ bases de línea (`unit_price × qty − discount`) − `total_cogs` (sin impuesto) |
| Ventas diarias | Serie por día en la zona de Ajustes, con días vacíos a 0 |
| Top productos (10) | Por **ingresos de línea** (`Σ order_items.total`, incluye impuesto); también `cogs` y `gross_profit` por SKU. Promos cuentan como **componentes** a precio asignado |
| Top promociones (10) | Paquetes estimados (`min(qty/receta)` por orden), órdenes e ingresos de línea de combo |
| Top clientes (5) | Nº de órdenes y gasto (`Σ orders.total`) **dentro del rango** |
| Métodos de pago | Órdenes y monto por método |

## Reglas
- **Se excluyen los reembolsos.**
- Agregación **en SQL**; el navegador solo pinta.
- Los límites del rango se calculan como `[00:00 del día inicial, 00:00 del día siguiente al final)` en la zona de Ajustes, sobre `coalesce(orders.occurred_at, orders.created_at)`: una venta offline (F2, [offline-y-sincronizacion](../06-roadmap/offline-y-sincronizacion.md)) cae en el día en que ocurrió, no en el día en que se sincronizó.
- Un combo a 17 000 con lista 20 000 aporta **17 000** (+ impuesto) a ingresos y ~**3 000** a `promo_markdown`, no 20 000 de lista. Ver [promociones](promociones.md) y [D-margin](../06-roadmap/decisiones-pendientes.md).

## Límites conocidos
- Sin exportación (CSV/PDF), sin gastos operativos (etapa 2), sin comparativas.
- Ingreso por producto incluye impuesto: la utilidad bruta usa la **base** sin impuesto.
- COGS y markdown de promo usan **precio/costo de catálogo actual**, no el del momento de la venta.
- El dashboard del cajero **no** muestra COGS/utilidad (solo `/reports`, gerente+).

Relacionados: [Dashboard](dashboard.md), [Promociones](promociones.md), [Ajustes](ajustes.md).
