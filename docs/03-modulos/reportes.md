# Módulo: Reportes

> Archivo: `app/(dashboard)/reports/page.tsx` (308 líneas) · Base: commit `54962b9`

## Qué muestra

| Sección | Cálculo | Problemas |
|---|---|---|
| **Last 7 Days Revenue** | Σ ventas de 7 días | Etiqueta correcta |
| **Total Orders** | Σ órdenes de esos 7 días | |
| **Avg Order Value** | ingresos / órdenes (7 días) | Solo 7 días; sin selector de rango |
| **Active Customers** | `topCustomers.length` | **Incorrecto**: es el tamaño de una lista de máximo 5, no clientes activos |
| **Daily Sales** | 7 consultas en `Promise.all` con `startOfDay/endOfDay` de date-fns (hora **local**) | Correcto en zona horaria (a diferencia del dashboard) pero 7 viajes |
| **Top 5 Best Sellers** | `order_items` con `limit(1000)` sin orden, agrupado **por nombre**, ordenado por ingresos | 1) No es el top real si hay más de 1000 líneas. 2) Agrupa por `product.name`: dos productos con el mismo nombre se fusionan. 3) Incluye ítems de órdenes **reembolsadas** |
| **Top 5 Customers** | `customers` ordenados por `total_spent desc` limit 5 + conteo de órdenes | 1) `total_spent` **no se mantiene** (seed/manual). 2) El conteo descarga **todas** las órdenes completadas (solo `customer_id`), topado por el límite de filas de PostgREST (1000 por defecto) |
| Columna **Loyalty Points** | `Math.floor(customer.total_spent)` (`:296`) | **No muestra `loyalty_points`**: es `total_spent` truncado, con etiqueta de puntos |

## Lo que el README promete y no existe

- "Profit analysis (ready)": **ningún cálculo de utilidad** (`selling_price − cost_price`) en reportes.
- "Sales analytics / Revenue charts": el reporte de ventas es una lista de 7 filas, no una gráfica (las gráficas están en el dashboard).
- Sin exportación (CSV/PDF), sin filtros por fecha/cajero/categoría/método de pago, sin reporte de inventario, gastos ni caja.

## Otros detalles

- `o.total` se suma sin `Number()`; depende de que PostgREST devuelva `numeric` como número (lo hace) — riesgo de
  precisión con valores grandes.
- `orderItems.forEach((item: any) => …)` (lint `no-explicit-any`).
- Estado de error: solo `console.error`; la pantalla queda vacía sin aviso.

## Cómo debería ser

Reportes con **rango de fechas**, calculados en SQL (`GROUP BY`) mediante vistas/RPC, excluyendo órdenes
reembolsadas, con agrupación por `product_id`, utilidad bruta (`Σ (unit_price − cost_price) × qty`),
desglose por método de pago y por cajero, y exportación. Permiso: gerente/admin (hoy cualquier cajero los ve).

## Pruebas sugeridas

1. Dos productos con el mismo nombre → aparecen separados.
2. Orden reembolsada → no suma a ingresos ni a "best sellers".
3. Más de 1000 líneas → los totales siguen siendo exactos.
4. Cliente sin ventas pero con `total_spent` en seed → no aparece como "top".
