# Módulo: Cuentas abiertas (tabs)

> Nuevo en la etapa 2 · `components/pos/tab-detail-sheet.tsx`, `open-tab-dialog.tsx`, `add-to-tab-dialog.tsx`, `tabs-panel.tsx` · API `app/api/v1/tabs/**` · Servicio `lib/server/services/tabs.ts` · Migración `supabase/migrations/20260922000002_tabs.sql` · Confianza: **[Verificado]** (`test/integration/tabs.test.ts`, incluida la prueba de concurrencia rompiendo el `FOR UPDATE` a propósito).

Una cuenta (`tabs`) es una venta en curso: una mesa, una persona o un grupo sin cuenta de cliente, a la que se le van añadiendo productos y que puede pagarse **en varias partes** antes de cerrarse.
Se abre y se cobra desde la pestaña **"Cuentas"** del carrito del POS ([pos-checkout](pos-checkout.md)).

## Modelo de datos
Cuatro tablas nuevas (`supabase/migrations/20260922000002_tabs.sql`), documentadas también en [esquema-tablas](../02-base-de-datos/01-esquema-tablas.md):

| Tabla | Qué guarda |
|---|---|
| `tabs` | `tab_number` (`TAB-000123`), `label`, `customer_id` opcional, `status` (`open`\|`closed`\|`voided`), `discount`, `order_id` (al cerrar), quién abrió/cerró/anuló y cuándo |
| `tab_members` | Las personas entre las que se divide (`display_name`); no requieren cuenta de cliente |
| `tab_items` | Producto, cantidad y **el precio y la tasa de impuesto del momento en que se añadió por primera vez** (foto, igual que `create_sale`) |
| `tab_payments` | Cada pago parcial: método, monto, y opcionalmente quién (`tab_members`) lo hizo |

`orders.tab_id` enlaza la orden final con la cuenta que la originó. Las cuatro tablas son de **solo lectura** desde la API (`cashier+`); toda escritura pasa por las RPC de abajo (regla dura 1 y 2 de `AGENTS.md`).

## Reglas de negocio
- **Stock:** se descuenta **al añadir** el producto a la cuenta (no al cerrarla) y se repone al quitar un ítem o anular. La cuenta es una venta ya en curso: el producto físico ya se separó.
- **Precio:** foto tomada la primera vez que se añade ese producto/variante; añadir más solo suma cantidad, nunca vuelve a cotizar las unidades ya puestas.
- **Visibilidad:** las cuentas son compartidas entre **todos los cajeros** (cualquiera puede atender cualquier mesa); no hay concepto de "mi cuenta".
- **Permisos:** el cajero abre cuentas, añade productos, personas y cobra. **Quitar un ítem o anular la cuenta requiere gerente o superior**, con motivo obligatorio.
- **División:** solo **pagos parciales** (no reservas de porcentaje). Cada persona paga su parte cuando quiera; la cuenta se cierra sola en cuanto lo pagado alcanza el total.
- **Descuento:** solo se puede fijar mientras la cuenta no tiene pagos (cambiarlo después dejaría mal calculada la parte de quien ya pagó).
- **Anular:** solo si la cuenta no tiene pagos; repone todo el stock.

## Cálculo del total (`_tab_totals`, interna)
La misma fórmula que `create_sale` (D3, ver [pos-checkout](pos-checkout.md)): por línea `base = precio × cantidad`, `impuesto = round(base × tasa, money_scale())`; `total = Σ(base+impuesto) − descuento`.
`balance = total − pagado`. Se expone de solo lectura vía la RPC `tab_summary(p_tab_id)` (usada por `GET /tabs/{id}`), para que el cliente nunca calcule el saldo por su cuenta.

## RPC transaccionales
Todas bloquean la fila de la cuenta (`SELECT … FOR UPDATE`) y exigen `status = 'open'` antes de actuar, así que dos acciones simultáneas sobre la **misma** cuenta se serializan en vez de competir.

| RPC | Rol | Qué hace |
|---|---|---|
| `open_tab(label, customer_id, members[])` | cajero | Crea la cuenta y sus personas iniciales |
| `tab_add_members(tab_id, names[])` | cajero | Añade más personas |
| `tab_add_items(tab_id, items[])` | cajero | Precio/impuesto desde la BD, descuenta stock atómicamente (igual que `create_sale`), hace *upsert* en `tab_items` |
| `tab_remove_item(tab_id, item_id, quantity, reason)` | **gerente+** | Reduce o quita la línea, repone stock; falla si el total resultante quedaría por debajo de lo ya pagado |
| `tab_set_discount(tab_id, discount)` | cajero | Solo si no hay pagos |
| `tab_pay(tab_id, member_id, method, amount)` | cajero | Rechaza un monto mayor al saldo; **cierra la cuenta sola** cuando el saldo llega a 0 |
| `void_tab(tab_id, reason)` | **gerente+** | Solo sin pagos; repone todo el stock |

## Cierre (`_close_tab`, interna — la llama `tab_pay`)
Cuando el saldo llega a 0: inserta una `orders` normal (`status='completed'`, `tab_id` apuntando a la cuenta), copia `tab_items` → `order_items` **sin volver a tocar el stock** (ya se descontó al añadir), copia `tab_payments` → `payments`
(varias filas — el esquema ya lo permitía) y marca la cuenta `closed` con su `order_id`. A partir de ahí es una orden como cualquier otra: aparece en [órdenes](ordenes-y-reembolsos.md) con un aviso "Cuenta TAB-xxx",
el trigger de clientes actualiza `total_spent`/`loyalty_points`, y **`refund_order` funciona sin cambios** (repone stock desde `order_items`). El dashboard, los reportes y el Top 5 ([dashboard](dashboard.md)) incluyen la venta automáticamente.

## API (`app/api/v1/tabs/**`)
`GET/POST /tabs` (lista paginada por `status`, alta) · `GET /tabs/{id}` (detalle con ítems, personas, pagos y totales) · `POST /tabs/{id}/items` · `DELETE /tabs/{id}/items/{itemId}` (gerente+, cuerpo `{quantity, reason}`) ·
`POST /tabs/{id}/members` · `POST /tabs/{id}/discount` · `POST /tabs/{id}/payments` · `POST /tabs/{id}/void` (gerente+). Esquemas zod en `lib/validation/tabs.ts`; servicio en `lib/server/services/tabs.ts`.

## Pantalla
- **Burbuja del carrito:** muestra también el número de cuentas abiertas.
- **`Sheet` del carrito** con dos pestañas: *Carrito* y *Cuentas*. En *Carrito*, además de *Checkout*, el botón **"Añadir a cuenta"** abre un diálogo para elegir una cuenta abierta o crear una nueva (etiqueta,
  cliente opcional, personas separadas por coma) y envía las líneas con `tab_add_items`.
- **Detalle de una cuenta** (`tab-detail-sheet.tsx`): ítems (con botón "Quitar" solo para gerente+), personas, resumen (subtotal/impuesto/descuento/total/pagado/saldo), pagos hechos, y el cobro:
  - **"Cobrar saldo completo"** en un solo pago.
  - **"Partes iguales":** se eligen las personas y `lib/tab-split.ts` reparte el saldo en unidades mínimas de la moneda (el resto va a las primeras partes, uno por uno, así la suma es siempre exacta); cada parte
    tiene su propio botón *Cobrar*.
  - **"Montos libres":** un campo por persona con lo que falta calculado en vivo (`lib/tab-split.ts#validateCustom`).
  - **La BD es la barrera real:** `tab_pay` valida cada cobro contra el saldo vivo, así que la sugerencia del cliente nunca puede resultar en un cobro de más.
  - **"Anular cuenta"** (gerente+, solo sin pagos) pide un motivo (≥ 3 caracteres).
  - Al cerrarse: `toast` con el número de orden y enlace a `/orders/{id}`.

## Supuestos sin validar con el negocio (D-tabs)
Registrados en [decisiones-pendientes](../06-roadmap/decisiones-pendientes.md): precio fijado al primer añadido, cuentas visibles para todos los cajeros, anular solo sin pagos, y que el Top 5 (`SECURITY DEFINER`) vea toda la tienda.

## Límites conocidos
- Sin página de historial de cuentas cerradas/anuladas aparte de su orden (`/tabs` como listado propio queda fuera de alcance).
- Sin propinas ni vuelto en el cobro de una cuenta (igual que la venta directa, D5).
- La sugerencia de "partes iguales"/"montos libres" es solo del lado del cliente; si dos cajeros cobran a la vez el saldo puede agotarse antes de que el segundo confirme (la RPC lo rechaza con un error, no con datos incorrectos).

Relacionados: [POS](pos-checkout.md), [Órdenes y reembolsos](ordenes-y-reembolsos.md), [RLS](../02-base-de-datos/03-rls-y-politicas.md), [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md).
