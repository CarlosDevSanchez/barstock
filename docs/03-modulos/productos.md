# Módulo: Productos

> Actualizado tras la etapa 1 · Pantalla `app/(dashboard)/products/page.tsx` · API `products`, `products/[id]` · Servicio `lib/server/services/products.ts` · Confianza: **[Verificado]** (`catalog.test.ts`, `product-form.test.tsx`).

## Quién puede qué
| Rol | Lista/detalle | Crear/editar/borrar |
|---|---|---|
| cajero | ✅ (sin columna "Cost" en la UI) | ❌ (`403`; sin botones) |
| gerente, admin | ✅ | ✅ (borrado **lógico**); borrado físico solo admin y solo por SQL/RLS |

## Qué hace
- **Lista** paginada (25) con búsqueda por nombre, SKU o código de barras (`ILIKE`, en servidor, con *debounce*); columnas producto, SKU, categoría, costo (gerente+), precio, **stock** (fila de inventario sin variante) y estado.
- **Formulario** (`react-hook-form` + `productCreateSchema`): nombre*, descripción, SKU*, código de barras, categoría, **tasa de impuesto en %**, costo* y precio*. Un producto nuevo arranca con la
  tasa por defecto de **Ajustes**. `''` se guarda como `null` (barcode, categoría, descripción): varios productos sin código de barras no chocan con `UNIQUE`.
- **Borrado:** `ConfirmDialog` → `DELETE` = `deleted_at = now()` y `is_active = false`. Desaparece del catálogo y del POS; **las ventas pasadas lo conservan**. El SKU queda reservado.

## Reglas de datos
| Campo | Regla |
|---|---|
| `name` | 1–200 caracteres, sin espacios sobrantes |
| `sku` | 1–64, **único** (409 al duplicar; también entre borrados lógicos) |
| `barcode` | opcional, ≤ 64, **único** si existe |
| `cost_price`, `selling_price` | `NUMERIC(14,2)`, ≥ 0; se redondea a la escala de la moneda de la tienda (0 decimales en COP, 2 en USD); la API rechaza más precisión de la permitida |
| `tax_rate` | **fracción** `NUMERIC(6,4)` entre 0 y 1 en la API (`0.10`); el formulario la muestra y recibe como **porcentaje** (`taxRatePercent`) |
| `is_active` | `boolean`; **no hay control en el formulario** (solo API/BD) |

Un producto nuevo recibe su fila de `inventory` con cantidad 0 por trigger; el stock se fija en [Inventario](inventario.md). Una venta de un producto sin stock falla.

## Endpoints
`GET /products?page&pageSize&q&category_id&active&ids` · `GET /products/{id}` · `POST /products` (gerente) · `PATCH /products/{id}` (gerente, solo lo enviado) · `DELETE /products/{id}` (gerente, 204).
`ids=a,b,c` (≤ 100) devuelve productos concretos con precio y stock **actuales**: lo usa el POS para valorar el carrito.

## Límites conocidos
- **`cost_price` es legible por cajeros** vía API/RLS (la UI solo oculta la columna): RLS filtra filas, no columnas. Ocultarlo del todo requeriría privilegios por columna o una vista.
- Sin imágenes (`image_url` existe en el esquema), sin variantes en la UI (D10), sin importación CSV, sin activar/desactivar desde la pantalla, sin restaurar borrados.
- Búsqueda solo por subcadena (sin normalizar acentos).

Relacionados: [Inventario](inventario.md), [Categorías](categorias.md), [POS](pos-checkout.md), [H3](../04-auditoria/hallazgos/H3-impuestos-y-dinero.md).
