# Módulo: Productos

> Actualizado con los modos de stock (`20261009000001`) · Pantalla `app/(dashboard)/products/page.tsx` · API `products`, `products/[id]`,
> `products/[id]/image` · Servicio `lib/server/services/products.ts` · Confianza: **[Verificado]** (`catalog.test.ts`,
> `product-images.test.ts`, `product-form.test.tsx`, `storage.test.ts`, `stock-modes.test.ts`).

## Quién puede qué
| Rol | Lista/detalle | Crear/editar/borrar |
|---|---|---|
| cajero | ✅ (sin columna "Cost" en la UI) | ❌ (`403`; sin botones) |
| gerente, admin | ✅ | ✅ (borrado **lógico**); borrado físico solo admin y solo por SQL/RLS |

## Qué hace
- **Lista** paginada (25) con búsqueda por nombre, SKU o código de barras (`ILIKE`, en servidor, con *debounce*); columnas producto, SKU, categoría, costo (gerente+), precio, **stock** (ver [modos de stock](#modos-de-stock): «Sin control», las unidades propias, o «2 (×15 de Cigarrillo)») y estado.
  Gerente+: en la fila de un producto que controla su stock, **«Crear presentación»** abre el formulario ya enlazado a ese base.
- **Formulario** (`react-hook-form` + `productCreateSchema`): nombre*, descripción, SKU*, código de barras, categoría, **tasa de impuesto en %**, costo* y precio* (con el panel de [márgenes](#márgenes)). Un producto nuevo arranca con la
  tasa por defecto de **Ajustes**. `''` se guarda como `null` (barcode, categoría, descripción): varios productos sin código de barras no chocan con `UNIQUE`.
- **Borrado:** `ConfirmDialog` → `DELETE` = `deleted_at = now()` y `is_active = false`. Desaparece del catálogo y del POS; **las ventas pasadas lo conservan**. El SKU queda reservado.

## Reglas de datos
| Campo | Regla |
|---|---|
| `name` | 1–200 caracteres, sin espacios sobrantes |
| `sku` | 1–64, **único** (409 con `details.field = 'sku'`; también entre borrados lógicos). El formulario marca el campo y sugiere `<sku>-2` |
| `barcode` | opcional, ≤ 64, **único** si existe (409 con `details.field = 'barcode'`: el formulario marca el código de barras, no el SKU) |
| `cost_price`, `selling_price` | `NUMERIC(14,2)`, ≥ 0; se redondea a la escala de la moneda de la tienda (0 decimales en COP, 2 en USD); la API rechaza más precisión de la permitida |
| `tax_rate` | **fracción** `NUMERIC(6,4)` entre 0 y 1 en la API (`0.10`); el formulario la muestra y recibe como **porcentaje** (`taxRatePercent`) |
| `is_active` | `boolean`; **no hay control en el formulario** (solo API/BD) |

Un producto nuevo recibe su fila de `inventory` con cantidad 0 por trigger; el stock se fija en [Inventario](inventario.md). Una venta de un producto que controla stock y no lo tiene falla.

## Modos de stock
Sección **Inventario** del formulario (`components/products/stock-mode-fields.tsx`), columna `products.stock_mode`:

| Modo | Para qué | Venta | Inventario |
|---|---|---|---|
| `own` — «Controla su propio stock» (por defecto) | Cervezas, snacks, el cigarrillo suelto | Descuenta sus unidades; sin stock falla | Aparece; se ajusta y se compra |
| `none` — «Sin control de stock» | Café, bebidas preparadas, servicios | **Siempre disponible**, nunca toca inventario (tampoco al reembolsar) | No aparece; no se puede comprar (`receive_purchase` lo rechaza) |
| `linked` — «Presentación de otro producto» | La caja de 15 cigarrillos | Descuenta `cantidad × stock_units` del **producto base** (`stock_product_id`) | No tiene fila propia: sus unidades viven en el base. Comprar «2 cajas» suma 30 al base |

- **El stock se cuenta en la unidad más pequeña** (el suelto). La caja y los sueltos compiten por las mismas unidades: con 20 cigarrillos
  se puede vender 1 caja (15) + 5 sueltos, o 20 sueltos. Cada presentación tiene **su propio precio, SKU, código de barras, imagen y costo**, así
  que el margen de vender suelto frente a por caja sale en los reportes línea a línea.
- **Un solo nivel**: el base debe ser `own` (no se encadenan presentaciones). Un base con presentaciones vivas no puede cambiar de modo ni
  borrarse (409). Pasar de `own` a otro modo exige tener el stock en 0 (409 con el motivo).
- `stock` en la API es el **stock efectivo**: `own` = sus unidades; `linked` = `floor(base / stock_units)` (cajas completas); `none` = `null`.
  `stock_base_quantity` son las unidades del base y `stock_base` su `{id, name}` (el POS los usa para el tope compartido, `lib/stock.ts`).
- El formulario valida: en `linked`, base y «Unidades del base por venta» (entero 2–10 000) son obligatorios; muestra en vivo «Vender 1
  descuenta 15 × Cigarrillo · disponibles ahora: N». **No sugiere costo ni precio** para la presentación: el costo y el precio los escribe
  quien crea el producto (antes había un botón «costo del base × unidades» que, con el paquete como base, proponía cifras absurdas). El
  umbral de stock bajo solo se pide en `own`.
- **Error frecuente: poner el paquete como base.** Si el base es el paquete y la presentación dice «10 unidades del base», el sistema entiende
  que vender 1 descuenta **10 paquetes**. Para comprar por paquete y vender por unidad, la **unidad** es el base (`own`, costo 1 300) y el
  paquete es la presentación ×10: comprar 1 paquete suma 10 unidades, vender 1 unidad descuenta 1, e Inventario muestra el equivalente
  («= 2 × Paquete + 3 sueltas»). La ayuda del modo `linked` lo explica en el formulario.
- Las líneas vendidas guardan una **foto** de dónde salió el stock (`order_items.stock_product_id/stock_units`): un reembolso devuelve al
  mismo sitio aunque el producto cambie después. Detalle en [funciones](../02-base-de-datos/04-triggers-y-funciones.md#modos-de-stock-20261009000001).
- Decisión y supuestos: D-stock en [decisiones pendientes](../06-roadmap/decisiones-pendientes.md). Recetas de insumos (café → gramos) quedan fuera.

## Márgenes
Bajo el precio de venta, el formulario muestra un panel **de solo lectura** (`components/products/margin-summary.tsx`, cálculo en
`lib/margin.ts`) que se recalcula mientras se escriben el costo y el precio. Reproduce la hoja de cálculo con la que el negocio fijaba precios
(`EJEMPLO PORCENTAJE PRODUCTO.xlsx`):

| Campo | Fórmula | Ejemplo (costo 2 217, venta 5 000, objetivo 35 %) |
|---|---|---|
| % margen objetivo | `settings.target_margin` ([Ajustes](ajustes.md)); 35 % por defecto | 35 % |
| Margen unitario | costo × objetivo | 776 |
| Precio sugerido | costo + margen unitario | 2 993 |
| Utilidad por unidad | venta − costo | 2 783 |
| % real | (venta − costo) / venta | 55,66 % |

- Es **informativo**: no se guarda en `products` ni impide guardar un precio por debajo del sugerido. En ese caso se muestra un aviso y
  el botón «Usar precio sugerido», que solo rellena el campo.
- Los importes se redondean a la escala de la moneda (`roundMoney`) y son **sin impuesto**, igual que `selling_price`: el IVA se suma en la venta.
- Utilidad y % real negativos (venta < costo) se muestran en rojo. Sin precio, el % real queda en «—».
- Ojo: el objetivo es un **markup sobre el costo** y el % real es un **margen sobre la venta**; no se comparan directamente (35 % sobre el
  costo equivale a un 25,9 % sobre la venta). Supuesto D-pricing en [decisiones pendientes](../06-roadmap/decisiones-pendientes.md).

## Endpoints
`GET /products?page&pageSize&q&category_id&active&ids` · `GET /products/{id}` · `POST /products` (gerente) · `PATCH /products/{id}` (gerente, solo lo enviado) · `DELETE /products/{id}` (gerente, 204).
`ids=a,b,c` (≤ 100) devuelve productos concretos con precio y stock **actuales**: lo usa el POS para valorar el carrito.
`stock_mode=own` o `stock_mode=own,linked` filtra por modo (selector del base; productos comprables).

`POST /products/{id}/image` (gerente, `multipart/form-data`, campo `file`) y `DELETE /products/{id}/image` (gerente): ver
[Imágenes de producto](#imagenes-de-producto) abajo.

## Imágenes de producto

- El navegador **reduce la imagen antes de subirla** (canvas → WebP, lado mayor ≤ 800 px; `lib/image-resize.ts`), para que el POS
  cargue miniaturas ligeras.
- El servidor valida los *magic bytes* reales (JPEG/PNG/WebP; nunca el nombre del archivo ni el `Content-Type` del navegador) y un
  tamaño máximo de 2 MB (`lib/server/storage.ts::validateImage`); `413`/`415` si no pasa.
- La imagen se guarda en un bucket **privado** de Cloudflare R2 con una clave generada por el servidor
  (`products/{productId}/{uuid}.webp|jpg|png`, columna `products.image_key` con `CHECK` de formato); **el cliente nunca elige ni ve la
  clave**. `listProducts`/`getProduct` la traducen a una URL firmada de 12 horas (`image_url`; la hora de firma se redondea a la hora para que el navegador pueda cachearla, y un fallo de carga se recuerda por URL, así que una URL nueva tras recargar la lista vuelve a mostrar la imagen); sin las 4 variables `R2_*`
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
