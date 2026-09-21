# C2 — Checkout y reembolso no atómicos; stock probablemente sin descontar; totales del cliente

| | |
|---|---|
| **Severidad** | Crítico |
| **Área** | Lógica de negocio / integridad de datos |
| **Esfuerzo** | Medio |
| **Estado** | Corregido (el POS usa `POST /sales`; `create_sale`/`refund_order` transaccionales, verificados en BD y en navegador). Pendiente de **Verificado**: test de concurrencia (Paso 6) |
| **Confianza** | Defectos de código **[Verificado]**; efecto real sobre el stock **[Por verificar]** con [`verificar-checkout.md`](../../05-guias/verificar-checkout.md) |

## Impacto

Inventario y caja descuadrados; ventas huérfanas sin pago o sin ítems; posibilidad de fraude por totales
manipulados. Es el corazón del producto.

## Hallazgo (evidencia)

### 1. Sin transacción — `pos/page.tsx:80-182`
Tres inserciones (`orders`, `order_items`, `payments`) y por cada ítem un `select` + `update` + `insert` de inventario,
todo desde el navegador. Cualquier fallo intermedio deja datos parciales (tabla completa en [pos-checkout](../../03-modulos/pos-checkout.md#qué-puede-salir-mal-y-qué-queda-en-la-base)).
Los resultados de `update` e `insert` del bucle de inventario **no se comprueban** y el toast siempre dice "Order completed successfully!".

### 2. `.eq('variant_id', null)` no filtra NULL — `pos/page.tsx:145`, `orders/[id]/page.tsx:71`
`postgrest-js` serializa `eq(col, value)` como `col=eq.${value}` (`node_modules/@supabase/postgrest-js/dist/index.mjs:431-433`),
es decir `variant_id=eq.null`. PostgREST **no** interpreta eso como `IS NULL` (para eso existe `.is(col, null)` → `is.null`).
Con una columna `uuid`, `eq.null` produce error 22P02; `.single()` devuelve `inventory = undefined` y el `if (inventory)` omite
el descuento **sin aviso**. El POS solo vende productos sin variante (`addItem(product)`), por lo que afectaría a **todas** las ventas.
El reembolso repite el patrón. **Verificar con una venta de prueba.**

### 3. Carrera de lectura-modificación-escritura — `pos/page.tsx:141-152`
`quantity − item.quantity` se calcula en el cliente con el valor leído. Dos cajas vendiendo lo mismo se pisan; sin `CHECK (quantity >= 0)` el stock puede quedar negativo.

### 4. Totales y precios confiados al cliente — `pos/page.tsx:93-120`
`subtotal`, `discount`, `tax`, `total`, `unit_price` los envía el navegador (precio tomado del `Product` cacheado en `localStorage`).
No hay `CHECK` ni trigger que valide. Con RLS permisivo ([C1](C1-rls-permisivo.md)) cualquiera puede insertar una orden con `total: 0`.

### 5. Reembolso no atómico ni idempotente — `orders/[id]/page.tsx:52-87`
Cambia el estado primero, luego repone stock; sin `WHERE status='completed'`; sin bitácora `return`; sin tocar `payments`; sin motivo ni autor.
Detalle: [ordenes-y-reembolsos](../../03-modulos/ordenes-y-reembolsos.md#reembolso--handlerefund-52-87).

### 6. Otros
- `order_number = ORD-${Date.now()}` (`:90`) puede colisionar entre cajas → violación de `UNIQUE`.
- Líneas con cantidad 0 se insertan en `order_items`.
- No se valida stock disponible antes de cobrar.
- Doble clic posible antes de que `processing` deshabilite el botón.

## Recomendación

Implementar **funciones RPC transaccionales** y dejar el cliente solo con ids y cantidades:

| RPC | Responsabilidad |
|---|---|
| `create_sale(customer_id, items jsonb, payment_method, discount)` | Bloquea inventario (`FOR UPDATE`), valida stock, lee precios e impuestos de la BD, calcula totales, inserta orden + ítems + pago + `inventory_transactions`, descuenta con `UPDATE … WHERE quantity >= n`, usa una **secuencia** para `order_number`; devuelve `order_id` |
| `refund_order(order_id, reason)` | `UPDATE orders … WHERE status='completed'` (idempotente), repone stock, registra `return`, marca el pago, guarda autor/fecha/motivo; solo gerente/admin |
| `adjust_inventory(inventory_id, delta, reason)` | Ajustes con bitácora |

Complementos: `CHECK (quantity >= 0)`, `CHECK` de coherencia de totales, snapshot de nombre/SKU en `order_items`,
`.is('variant_id', null)` mientras coexista código cliente, y revocar escrituras directas (ver [C1](C1-rls-permisivo.md)).
Borrador en [`diseno-objetivo-seguridad.md`](../../06-roadmap/diseno-objetivo-seguridad.md).

## Criterios de aceptación

- [ ] Una venta de 1 unidad con stock 50 deja stock 49, 1 orden, 1 ítem, 1 pago y 1 transacción `sale`.
- [ ] Una venta que excede el stock es rechazada sin escribir nada.
- [ ] Dos ventas simultáneas del último ítem: solo una tiene éxito.
- [ ] Forzar un error en el paso de pago revierte todo (no queda orden huérfana).
- [ ] El precio cobrado es el de la BD, aunque el cliente envíe otro.
- [ ] Reembolsar dos veces la misma orden repone el stock **una** vez y devuelve error la segunda.
- [ ] Un `cashier` no puede insertar en `orders`/`payments` por API directa.
- [ ] Pruebas automatizadas de los casos anteriores en CI.

## Dependencias

Requiere el modelo de permisos de [C1](C1-rls-permisivo.md) y la decisión de impuestos de [H3](H3-impuestos-y-dinero.md).
