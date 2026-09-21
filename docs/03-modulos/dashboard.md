# Módulo: Dashboard

> ⚠️ **Describe el estado ANTERIOR a la etapa 1 (commit `54962b9`).** Desde entonces el navegador solo habla con `/api/v1`, RLS es por rol y la
> lógica de negocio vive en RPC de la BD: ver [API](../01-arquitectura/08-api.md) y [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md). Este documento se reescribe en el Paso 8.

> Archivo: `app/(dashboard)/dashboard/page.tsx` (277 líneas) · Base: commit `54962b9`

## Qué muestra

4 tarjetas KPI, 2 gráficas (Recharts) y una lista de alertas de bajo stock. Todo se calcula en el navegador
en un único `fetchDashboardData` (`:28-128`).

| Elemento | Cómo se calcula | Problemas |
|---|---|---|
| **Today's Revenue** + "From N orders" | `orders.total` con `status='completed'` y `created_at >= 'YYYY-MM-DD'` (fecha **UTC**), sumado en JS | El "hoy" es UTC, no el del negocio: entre la medianoche local y la UTC las ventas caen en el día equivocado |
| **Monthly Revenue** | `created_at >= primer día del mes local` (`toISOString`) | Inicio de mes local convertido a UTC (correcto), pero inconsistente con "hoy" |
| **Customers** | `count exact, head` de `customers` | Cuenta también inactivos |
| **Low Stock** | `lowStock.length` | **Tope artificial de 5**: la consulta usa `.limit(5)` y el KPI es la longitud del resultado |
| **Sales Overview** (línea, 7 días) | Bucle `for` con **7 consultas secuenciales** (`await` dentro del bucle) | Lento (7 viajes en serie); rangos por día en UTC |
| **Top Products** (barras) | `order_items` con `limit(100)` **sin orden ni filtro**, agrupado por `product_id` en JS, top 5 por cantidad | No es el "top" real: son 100 filas arbitrarias. Incluye ítems de órdenes **reembolsadas** |
| **Low Stock Alerts** | `inventory` con `quantity < 10` (`.lt('quantity', 10)`, umbral **fijo**), `limit(5)` | Ignora `low_stock_threshold` por fila (que sí se muestra como "Min:") |

Color del texto de la alerta: rojo si `quantity < 5`, naranja si no.

## Otros detalles

- Estado de carga: spinner; **no hay estado de error** (solo `console.error`).
- Los importes usan `$` fijo y `toFixed(2)`; el tooltip de Recharts no formatea moneda.
- Colores de gráfica fijos (`#10B981`); no siguen el tema oscuro (ejes usan clases de texto).
- Tipos: `useState<any[]>` (2) y `(item.product as any)?.name` (lint).
- Se carga `Number(order.total)` (defensivo); `reports` no.
- Sin actualización en tiempo real (el README lo lista como "ready for implementation").

## Cómo debería ser

Una función/vista SQL agregada que devuelva en **una llamada**:

```
ingresos_hoy, ordenes_hoy, ingresos_mes, clientes_activos,
bajo_stock_count (usando low_stock_threshold), serie_diaria_7d, top_productos_5
```

con la zona horaria del negocio (parámetro en `settings`), excluyendo órdenes no `completed`,
y protegida por RLS/rol. El cliente solo renderiza.

## Pruebas sugeridas

1. Venta a las 23:30 local: aparece en "hoy" del día local.
2. 8 productos con bajo stock: el KPI dice 8 (hoy dice 5).
3. Venta reembolsada: no cuenta en ingresos ni en top productos.
4. Más de 100 líneas de venta: el top refleja el total histórico o el periodo elegido.
