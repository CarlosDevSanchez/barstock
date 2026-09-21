# Módulo: Inventario

> ⚠️ **Describe el estado ANTERIOR a la etapa 1 (commit `54962b9`).** Desde entonces el navegador solo habla con `/api/v1`, RLS es por rol y la
> lógica de negocio vive en RPC de la BD: ver [API](../01-arquitectura/08-api.md) y [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md). Este documento se reescribe en el Paso 8.

> Archivo: `app/(dashboard)/inventory/page.tsx` (137 líneas) · Base: commit `54962b9`

## Qué hace

Vista **solo de lectura** del stock. No hay alta, ajuste, recepción ni edición de umbrales:
la página no contiene ningún `insert`, `update` ni `delete`.

## Datos

`inventory` con `product: products(*)`, ordenado por `quantity asc` (los más bajos primero), sin paginar.

## Indicadores

| Tarjeta | Cálculo | Nota |
|---|---|---|
| Total Items | `Σ quantity` | El subtítulo "Across N products" cuenta **filas de inventario**, no productos |
| Low Stock Alert | filas con `quantity < low_stock_threshold` | Usa el umbral **por fila** (correcto; el dashboard usa 10 fijo) |
| Stock Value | `Σ quantity × product.cost_price` | Ignora variantes (`variant.cost_price`) |

Tabla: producto, SKU, cantidad (rojo si es bajo), umbral, estado (`Low Stock`/`In Stock`), valor. Buscador por
nombre o SKU. **No hay columna de variante**: una fila de variante se vería igual que la del producto base.

## Cómo entra el stock hoy

- Solo por el `seed.sql` o insertando filas a mano en Supabase. **Ninguna pantalla crea inventario**
  ni lo hace la creación de productos.
- Solo sale stock por el checkout (con los defectos de [C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md)) y vuelve por el reembolso.
- Las compras a proveedores (`purchase_orders`) no existen en la UI, por lo que no hay entrada de mercancía.

## Defectos y riesgos

| # | Detalle |
|---|---|
| 1 | Sin flujo de recepción, conteo físico ni ajuste (con motivo y bitácora) |
| 2 | Puede mostrar cantidades negativas (sin `CHECK`), marcadas como "Low Stock" |
| 3 | `setInventory(data as any)`; ESLint reporta `react-hooks/immutability` por `fetchInventory` usado antes de declararse |
| 4 | Duplicados posibles de (producto, `NULL`) por la restricción `UNIQUE` ([índices](../02-base-de-datos/05-indices-y-constraints.md)) |
| 5 | Sin ubicación (`location`) ni fecha de reposición en la UI aunque existen las columnas |
| 6 | RLS permite a cualquiera modificar el stock directamente por API |

## Siguiente paso recomendado

Implementar RPC `adjust_inventory(inventory_id, delta, reason)` con bitácora en `inventory_transactions`,
pantalla de ajuste/recepción (gerente+), y edición de `low_stock_threshold`.
