# Módulo: Ajustes

> Actualizado con `offline_max_hours` (F2) · `app/(dashboard)/settings/page.tsx` · API `GET/PATCH /settings`,
> `POST/DELETE /settings/logo` · Servicio `services/settings.ts` · Confianza: **[Verificado]** (`admin.test.ts`, `rls.test.ts`,
> `product-images.test.ts`, `offline-sales.test.ts`, e2e).

Antes: la pantalla era decorativa (no persistía nada) y había tres fuentes de "ajustes" desconectadas. Ahora hay **una**: la tabla `settings` (D11: solo BD).

## Quién
**Todos** los usuarios activos **leen** (necesitan moneda y nombre de tienda); **solo el admin escribe** (`403` a otros; RLS también). La pantalla es solo para admin (`proxy.ts`).

## Claves (una fila JSONB por clave)
| Clave | Validación | Dónde se usa |
|---|---|---|
| `store_name`, `store_address`, `store_phone`, `store_email` | texto (email válido o vacío) | Nombre en la barra lateral |
| `store_tax_id` | texto ≤ 30, opcional | NIT impreso en el [ticket de 80 mm](ordenes-y-reembolsos.md) |
| `store_logo_key` | texto ≤ 200, **generada por el servidor** (no PATCH-able desde el body; `settingsUpdateSchema` la omite) | Clave de storage del logo del ticket (`settings/logo/{uuid}.ext`, bucket privado de R2); se sube con `POST /settings/logo` (admin, `multipart/form-data`, campo `file`) y se borra con `DELETE /settings/logo`. `getSettings` la traduce a `store_logo_url` (URL firmada, 1 h); sin las 4 variables `R2_*` el endpoint responde `503 storage_not_configured` |
| `currency` | código ISO 4217 **existente** (`Intl.supportedValuesOf`) | **Todo el dinero de la UI** (`useMoney`); defecto **COP**. Los decimales de cobro salen de `currencyDecimals` / `money_scale` (0 en COP) |
| `timezone` | zona IANA válida | Agrupación por días en dashboard y reportes (SQL); defecto `America/Bogota` |
| `tax_rate` | fracción 0–1 (el formulario usa %) | **Tasa por defecto al crear un producto** (cada producto conserva la suya; **no interviene en las ventas**); defecto `0.19` (supuesto D3) |
| `low_stock_threshold` | entero ≥ 0 | Umbral de la fila de inventario de los **productos nuevos** (los existentes conservan el suyo) |
| `offline_max_hours` | entero 1–168 | Ventana máxima que `create_sale` acepta para `occurred_at` en una venta offline; fuera de rango se recorta (`sync_issues.occurred_at_clamped`); defecto `12`. Ver [pos-checkout](pos-checkout.md) y [offline-y-sincronizacion](../06-roadmap/offline-y-sincronizacion.md) (F2) |
| `receipt_template` | `{ header, footer }` (≤ 200) | Encabezado/pie del [ticket de 80 mm](ordenes-y-reembolsos.md) |

Si una clave falta o su valor es inválido, el servicio devuelve el **valor por defecto** (`SETTINGS_DEFAULTS`) en lugar de romper la app (probado). `PATCH` acepta un subconjunto y hace *upsert* por clave.

## Comportamiento
- El **layout servidor** lee los ajustes y los pasa por `SessionProvider`. Tras guardar, `router.refresh()` los propaga (el nombre de la tienda y la moneda cambian sin recargar).
- El botón "Save Settings" solo se activa si hay cambios.

## Límites conocidos
- Sin auditoría de cambios de ajustes (quién y cuándo).
- Una moneda por instalación (**D4 decidido**: COP por defecto; decimales según la moneda). El formateo usa el idioma del usuario (`profiles.locale` → `es-CO` / `en-US`).
- Cambiar la zona horaria o la moneda no reexpresa datos históricos: solo cómo se agrupan y se muestran.

Relacionados: [Dashboard](dashboard.md), [Reportes](reportes.md), [Productos](productos.md), [UI](../01-arquitectura/06-ui-y-diseno.md), [decisiones pendientes](../06-roadmap/decisiones-pendientes.md) (D4, D11, D12).
