# Módulo: Productos

> Actualizado tras la etapa 3 (Fase 6, imágenes) · Pantalla `app/(dashboard)/products/page.tsx` · API `products`, `products/[id]`,
> `products/[id]/image` · Servicio `lib/server/services/products.ts` · Confianza: **[Verificado]** (`catalog.test.ts`,
> `product-images.test.ts`, `product-form.test.tsx`, `storage.test.ts`).

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

`POST /products/{id}/image` (gerente, `multipart/form-data`, campo `file`) y `DELETE /products/{id}/image` (gerente): ver
[Imágenes de producto](#imagenes-de-producto) abajo.

## Imágenes de producto

- El navegador **reduce la imagen antes de subirla** (canvas → WebP, lado mayor ≤ 800 px; `lib/image-resize.ts`), para que el POS
  cargue miniaturas ligeras.
- El servidor valida los *magic bytes* reales (JPEG/PNG/WebP; nunca el nombre del archivo ni el `Content-Type` del navegador) y un
  tamaño máximo de 2 MB (`lib/server/storage.ts::validateImage`); `413`/`415` si no pasa.
- La imagen se guarda en un bucket **privado** de Cloudflare R2 con una clave generada por el servidor
  (`products/{productId}/{uuid}.webp|jpg|png`, columna `products.image_key` con `CHECK` de formato); **el cliente nunca elige ni ve la
  clave**. `listProducts`/`getProduct` la traducen a una URL firmada de 1 hora (`image_url`); sin las 4 variables `R2_*`
  ([variables de entorno](../05-guias/variables-de-entorno.md)) el endpoint responde `503 storage_not_configured` y la UI oculta el
  selector.
- Reemplazar una imagen borra la anterior; si la subida se completa pero la escritura en BD falla, se borra el objeto recién subido
  (sin huérfanos). Si la imagen falla al guardar producto y foto juntos desde el formulario, **el producto ya quedó guardado**: se
  avisa con un *toast*, no se pierde el resto de los datos.
- La columna vieja `products.image_url` **no se usa** (se conserva por compatibilidad histórica, nunca se vuelve a escribir).

## Límites conocidos
- **`cost_price` es legible por cajeros** vía API/RLS (la UI solo oculta la columna): RLS filtra filas, no columnas. Ocultarlo del todo requeriría privilegios por columna o una vista.
- Sin variantes en la UI (D10), sin importación CSV, sin activar/desactivar desde la pantalla, sin restaurar borrados.
- Búsqueda solo por subcadena (sin normalizar acentos).

Relacionados: [Inventario](inventario.md), [Categorías](categorias.md), [POS](pos-checkout.md), [H3](../04-auditoria/hallazgos/H3-impuestos-y-dinero.md).
