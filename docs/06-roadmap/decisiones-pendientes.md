# Decisiones pendientes (producto y negocio)

> Preguntas que **bloquean o condicionan** decisiones técnicas. Cada una debe resolverse con quien defina el negocio y, al
> cerrarse, registrarse aquí con fecha y responsable (formato ADR ligero). Nada de esto se asume en el código actual.
> Base: commit `54962b9`.

## Tabla resumen

| ID | Decisión | Bloquea | Recomendación técnica | Estado |
|---|---|---|---|---|
| D1 | ¿Registro público, por invitación o solo admin crea usuarios? | [C1](../04-auditoria/hallazgos/C1-rls-permisivo.md) | Solo admin crea/invita usuarios | **Decidido (2026-09-21, propietario)**: solo por invitación del admin |
| D2 | ¿Un solo negocio, o varias sucursales/tiendas? | Esquema (`store_id`), RLS | Si hay riesgo de multi-sucursal, añadir `store_id` **antes** de más datos | Pendiente |
| D3 | Regla fiscal: ¿tasa por producto o global? ¿precio con o sin impuesto? ¿redondeo por línea o por total? ¿descuento antes o después del impuesto? | [H3](../04-auditoria/hallazgos/H3-impuestos-y-dinero.md), `create_sale` | Tasa por producto, precios sin impuesto, redondeo por línea, descuento antes del impuesto — **validar con contabilidad** | **Supuesto aplicado, sin validar** (ver abajo) |
| D4 | Moneda: ¿única o varias? ¿formato regional? | UI, `settings` | Una moneda por instalación, configurable; `Intl.NumberFormat` | **Decidido (2026-09-21)**: COP por defecto, decimales según la moneda (`money_scale` / `currencyDecimals`) |
| D5 | Pagos: ¿mixtos (efectivo+tarjeta)? ¿vuelto? ¿propinas? ¿integración con terminal? | `payments`, UI de cobro | Permitir varios pagos por orden (el esquema ya lo permite) y calcular vuelto | Pendiente |
| D6 | Descuentos: ¿topes por rol? ¿motivo obligatorio? ¿aprobación de gerente? | `create_sale`, RLS | Tope por rol y motivo sobre cierto monto, auditado | Pendiente |
| D7 | Fidelidad: ¿cómo se acumulan y canjean los puntos? ¿los reembolsos los restan? | [clientes](../03-modulos/clientes.md) | Derivar de las órdenes (trigger/vista), no editar a mano | **Supuesto aplicado, sin validar**: `floor(total_spent)`, reembolsos restan. En COP ≈ 1 punto por peso — escala por revisar |
| D8 | Reembolsos: ¿parciales? ¿ventana de tiempo? ¿quién autoriza? ¿devuelve al stock siempre? | `refund_order` | Solo gerente/admin, con motivo; parcial por ítem como evolución | Pendiente |
| D9 | Stock: ¿se permite vender sin stock o sin fila de inventario? ¿stock negativo? | `create_sale`, `CHECK` | No permitir negativo; productos sin control de stock marcados explícitamente | **Supuesto aplicado, sin validar**: nunca negativo; vender sin fila de inventario falla. Excepción añadida en F2: una venta **offline** nunca se rechaza por falta de stock (se descuenta hasta 0 y el faltante queda en `sync_issues.stock_shortfall`), decisión tomada 2026-09-22 (ver [offline-y-sincronizacion](offline-y-sincronizacion.md)) |
| D10 | Variantes: ¿se venden desde el POS? ¿qué atributos? | UI del POS, inventario | Si sí: selector de variante y alta en productos | Pendiente |
| D11 | Ajustes: ¿en BD (`settings`), en cliente, o ambos? | [ajustes](../03-modulos/ajustes.md) | **Solo BD** (tabla `settings`) con RLS solo-admin | Pendiente |
| D12 | Idioma de la interfaz | UI | Definir si se traduce (i18n) o se queda en inglés | **Decidido (2026-09-21)**: ES por defecto + EN; idioma por usuario (`profiles.locale`), sin segmento `[locale]` en la URL |
| D13 | Entornos y despliegue: ¿Vercel + un Supabase por entorno? ¿quién despliega? | CI/CD, variables | dev / staging / prod separados; despliegue por PR | Pendiente |
| D14 | Datos personales de clientes: retención, borrado, consentimiento, normativa aplicable | Clientes, RLS, backups | Minimizar campos; política de retención; acceso por rol | Pendiente |
| D15 | Hardware: lector de códigos, impresora térmica, cajón de dinero | POS, recibo | Lector como teclado (auto-agregar con Enter); impresión ESC/POS o recibo HTML | Pendiente |
| D16 | ¿Se necesita operar **sin conexión**? | Arquitectura del POS | Hoy es imposible (todo va a Supabase). Si sí, requiere cola offline y sincronización — cambio grande | **Mayormente implementado para ventas nuevas** (F0–F3): lectura offline (PWA, instantánea del catálogo — F1), `create_sale` idempotente (F0) y listo para una venta offline con su hora/total provisional/faltante de stock (F2), y **cobrar ya funciona sin red** — se encola en IndexedDB y un motor de sincronización lo manda solo al volver la conexión (F3). Cuentas abiertas, ajustes de inventario y reembolsos siguen deshabilitados sin red (fuera de alcance v1). Falta la UI de seguimiento (centro de sincronización, ticket "PROVISIONAL", revisión de gerente — F4). Ver [offline-y-sincronizacion](offline-y-sincronizacion.md) |
| D17 | Roles: ¿bastan admin/gerente/cajero? ¿permisos finos? | RLS | Empezar con 3 roles; tabla de permisos si crece | Pendiente |
| D18 | Backups: RPO/RTO aceptables; quién restaura | [migraciones](../02-base-de-datos/06-seed-y-migraciones.md) | PITR si el negocio no tolera perder ventas | Pendiente |
| D19 | Política de rotación de claves y accesos | [variables de entorno](../05-guias/variables-de-entorno.md) | Rotación tras salida de personal y ante sospecha | Pendiente |
| D20 | Licencia del proyecto (el README declara MIT; no hay `LICENSE`) | Legal | Definir con el cliente/propietario; añadir `LICENSE` acorde | Pendiente |
| D21 | Ticket POS de 80 mm: ¿comprobante interno o factura electrónica (CUFE, QR, resolución DIAN)? | `receipt-ticket.tsx`, ventas al por menor | Comprobante **no fiscal** para esta fase; factura electrónica es un proyecto aparte (DIAN, numeración autorizada, firma) | **Decidido (2026-09-22, propietario)**: no es factura electrónica |
| D-promos | ¿Paquetes fijos multi-producto? ¿Tabs? ¿Precio en líneas expandidas? | `promotions`, `create_sale`, `tab_add_items`, POS | Paquetes a precio fijo; expansión en RPC con precio **asignado**; tabs **sí** (migración `20260925000001`) | **Decidido (2026-09-22)**: ver abajo |
| D-margin | ¿Utilidad bruta? ¿Congelar costo/lista en la venta? | `sales_report`, reportes | Base cobrada − `cost_price` actual; markdown de promo vs lista actual; sin snapshot v1 | **Decidido (2026-09-22)**: ver abajo |
| D-audit | Retención de `audit_log`: crece sin límite y nadie puede borrarla (append-only por diseño). ¿Archivar filas antiguas, particionar por fecha, o dejarla crecer? | `audit_log`, `docs/03-modulos/auditoria.md` | Sin propuesta todavía: depende del volumen real y de si hay una obligación legal de conservación | Pendiente |

## Supuestos aplicados en la etapa 1 (a validar con el negocio)

Se implementaron para poder cerrar la base técnica; **cambiarlos es una migración**, no un rediseño:

| ID | Supuesto implementado (`create_sale` / triggers) |
|---|---|
| D3 | Impuesto **por producto** (`products.tax_rate`, fracción); precios **sin** impuesto; redondeo **por línea** (`round(base × tasa, 2)`); descuento de línea antes del impuesto; **descuento global después del impuesto** (`total = Σ base + Σ impuesto − descuento`). `settings.tax_rate` queda como tasa por defecto para productos nuevos, no interviene en las órdenes |
| D7 | `loyalty_points = floor(total_spent)`; `total_spent` = Σ de órdenes `completed`; un reembolso resta. Con COP por defecto eso son ≈ 1 punto por peso — pendiente de calibrar con el negocio |
| D9 | Stock nunca negativo (`CHECK` + `UPDATE … WHERE quantity >= n`); un producto sin fila de inventario no se puede vender; cada producto nuevo recibe su fila con cantidad 0. **Camino offline (F2, `occurred_at` no nulo):** el `CHECK` se mantiene (nunca negativo), pero no se rechaza la venta — se descuenta lo que haya y el faltante se anota en `orders.sync_issues.stock_shortfall` |
| D8 | Reembolso **total**, solo gerente/admin, con motivo, idempotente |
| D6 | Sin topes de descuento por rol (sigue pendiente) |

## Supuestos aplicados en la etapa 2 (cuentas abiertas y Top 5, a validar con el negocio)

Igual que en la etapa 1: se implementaron para cerrar la base técnica de [cuentas-abiertas](../03-modulos/cuentas-abiertas.md);
cambiarlos también es una migración.

| ID | Supuesto implementado |
|---|---|
| D-tabs1 | El precio de un `tab_item` es una **foto** tomada la primera vez que ese producto se añade a la cuenta; añadir más tarde el mismo producto suma cantidad pero **no** vuelve a cotizarlo (igual que `create_sale` fija el precio al vender) |
| D-tabs2 | Las cuentas abiertas son **visibles y editables por cualquier cajero** (no solo quien la abrió): en un bar/restaurante cualquiera puede atender cualquier mesa |
| D-tabs3 | Una cuenta solo se puede **anular** mientras no tiene pagos; con pagos, la única salida es cobrar el saldo (se cierra sola) o dejarla abierta |
| D-top5 | `top_selling_products` es `SECURITY DEFINER` a propósito: el panel de venta rápida muestra la moda de **toda la tienda**, no solo las ventas de quien está en la caja (a diferencia de `dashboard_summary`, que sí respeta "solo mis ventas" para un cajero) |

### D4 — Decidido 2026-09-21
Decisión: una moneda por instalación (tabla `settings`); valor por defecto **COP**; decimales de cobro y precios según la moneda (`public.money_scale()` / `currencyDecimals`: 0 para COP y otras monedas de unidad entera, 2 para el resto). Montos ampliados a `NUMERIC(14,2)`.
Motivo: el negocio opera en Colombia; `NUMERIC(10,2)` y centavos fijos no sirven para pesos.
Impacto: migración `20260921000006_locale_and_money.sql`, `lib/money.ts`, `create_sale`, seed y defaults.

### D12 — Decidido 2026-09-21
Decisión: UI en **español por defecto** con inglés como alternativa; idioma **por usuario** en `profiles.locale` (`es` \| `en`), sin segmento `[locale]` en la URL (`next-intl`).
Motivo: el personal puede preferir EN; la tienda es ES.
Impacto: `next-intl`, `PATCH /api/v1/me`, cookie `NEXT_LOCALE`, diccionarios `messages/{es,en}.json`.

### D21 — Decidido 2026-09-22
Decisión: el ticket de 80 mm que imprime `orders/[id]` (`components/orders/receipt-ticket.tsx`) es un **comprobante de
venta no fiscal** («COMPROBANTE DE VENTA — No es factura electrónica»). No incluye CUFE, código QR, resolución de
numeración DIAN, ni «recibido/cambio» (el efectivo entregado por el cliente no se guarda).
Motivo: emitir factura electrónica válida ante la DIAN requiere numeración autorizada, firma y un proveedor
tecnológico homologado — fuera del alcance de esta fase (Fase 5 del plan de UI).
Alternativas descartadas: integrar un PSE/facturador electrónico ahora mismo (se pospone a una fase futura si el
negocio lo requiere).
Impacto en el código/BD: migración `20260923000002_receipt.sql` (`order_items.tax_rate`, snapshot vía trigger;
`settings.store_tax_id`/`store_logo_key`), `lib/receipt.ts`, `components/orders/receipt-ticket.tsx`,
`app/(dashboard)/orders/[id]/page.tsx`, `app/globals.css`, `components/app-shell.tsx`.

### D-promos — Decidido 2026-09-22 (tabs 2026-09-22)
Decisión: promociones v1 = **paquetes fijos** multi-producto a `package_price`. Venta híbrida (carrito/ticket agrupan;
BD descompone con precio **asignado**, no `selling_price` de lista). Soft-delete; sin hard delete. **Promos en
cuentas abiertas** vía `tab_add_items` (`tab_items.promotion_id` + `discount`; unique incluye promo). Top 5 / reportes
por SKU cuentan componentes. Impuesto por producto sobre la base asignada (sigue atado a D3).
Impacto: migraciones `20260924000001` / `20260924000002` / `20260925000001`, `lib/promotion-allocate.ts`, POS, ticket agrupado.

### D-margin — Decidido 2026-09-22
Decisión: en `sales_report` (solo gerente+): **ingreso** = lo cobrado (`orders.total` / líneas asignadas);
**promo_markdown** = lista actual × qty − base asignada (líneas con `promotion_id`); **COGS** = qty ×
`cost_price` actual; **utilidad bruta** = Σ bases de línea − COGS. Sin snapshot de costo/lista en `order_items` (v1).
El descuento de combo **no** se mezcla con `orders.discount` (descuento global). Dashboard del cajero sin COGS.
Motivo: evitar reportar precio de lista (p. ej. 20 000) cuando se cobró el paquete (17 000); utilidad operativa
aceptable con costo de catálogo actual.
Impacto: migración `20260924000003_sales_report_promo_margin.sql`, `/reports`, [reportes](../03-modulos/reportes.md).

## Detalle de las decisiones de mayor impacto

### D3 — Regla fiscal
Impacta el cálculo de `create_sale`, el tipo de `tax_rate`, los reportes y la contabilidad. Hoy coexisten dos criterios
([H3](../04-auditoria/hallazgos/H3-impuestos-y-dinero.md)). Preguntas concretas para contabilidad:
1. ¿Los precios que ve el cliente incluyen impuesto?
2. ¿Hay productos exentos o con tasa reducida?
3. ¿Se aplica el descuento antes o después del impuesto?
4. ¿Cuál es la regla de redondeo aceptada por la autoridad fiscal?
5. ¿Se requiere factura/comprobante fiscal con formato específico?

### D2 — Multi-sucursal
Añadir `store_id` después es costoso (migración de datos, RLS, reportes). Si existe una posibilidad razonable de más de un local, decidirlo antes de la Fase 1.

### D9 — Stock
Determina si una venta sin fila de `inventory` falla o se permite, y si existe "producto sin control de inventario" (servicios, bebidas
preparadas). Impacta la UX del POS.

## Cómo registrar una decisión

Sustituir `Pendiente` por `Decidido (AAAA-MM-DD, responsable)` y añadir bajo la tabla:

```
### D3 — Decidido 2026-xx-xx (nombre/rol)
Decisión: …
Motivo: …
Alternativas descartadas: …
Impacto en el código/BD: … (enlaces a PR y migración)
```
