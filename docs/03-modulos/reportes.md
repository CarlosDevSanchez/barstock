# Módulo: Reportes

> Actualizado tras la etapa 1 · `app/(dashboard)/reports/page.tsx` · API `GET /reports?from&to` · RPC `sales_report` · Confianza: **[Verificado]** (`admin.test.ts`: cifras exactas sobre un día aislado).

- **Quién:** gerente y admin (`403` al cajero; `proxy.ts` lo redirige).
- **Rango:** dos fechas (`YYYY-MM-DD`), por defecto los últimos 7 días **en la zona de Ajustes**. Máximo **366 días** (`422` si se supera o si `from > to`).

## Contenido
| Sección | Definición |
|---|---|
| Ingresos, órdenes, ticket medio, impuestos, descuentos | Sobre órdenes `completed` del rango |
| Ventas diarias | Serie por día en la zona de Ajustes, con días vacíos a 0 |
| Top productos (10) | Por **ingresos de línea** (`Σ order_items.total`, incluye impuesto; **no** incluye el descuento global) |
| Top clientes (5) | Nº de órdenes y gasto (`Σ orders.total`) **dentro del rango** (antes: el `total_spent` acumulado) |
| Métodos de pago | Órdenes y monto por método |

## Reglas
- **Se excluyen los reembolsos.** Antes el top de productos los contaba y solo miraba las primeras 100/1000 líneas sin ordenar.
- Agregación **en SQL**; el navegador solo pinta.
- Los límites del rango se calculan como `[00:00 del día inicial, 00:00 del día siguiente al final)` en la zona de Ajustes.

## Límites conocidos
- Sin exportación (CSV/PDF), sin gastos ni utilidad (los gastos no tienen UI: etapa 2), sin comparativas.
- Ingreso por producto incluye impuesto: para "ventas netas" habría que restarlo.

Relacionados: [Dashboard](dashboard.md), [Ajustes](ajustes.md).
