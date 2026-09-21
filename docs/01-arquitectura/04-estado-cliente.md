# Estado del cliente (Zustand)

> ⚠️ **Describe el estado ANTERIOR a la etapa 1 (commit `54962b9`).** Desde entonces el navegador solo habla con `/api/v1`, RLS es por rol y la
> lógica de negocio vive en RPC de la BD: ver [API](08-api.md) y [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md). Este documento se reescribe en el Paso 8.

> Base: commit `54962b9` · Confianza: **[Verificado]**

Hay tres stores en `stores/`. Solo dos persisten en `localStorage`. Uno no se usa.

| Store | Archivo | Persistencia (clave) | ¿Usado? |
|---|---|---|---|
| `useAuthStore` | `stores/auth.ts` | No | Sí: layout (`setUser`) y POS (`user.id`) |
| `useCartStore` | `stores/cart.ts` | `localStorage['pos-cart']` | Sí: solo el POS |
| `useSettingsStore` | `stores/settings.ts` | `localStorage['pos-settings']` | **No** (0 importaciones) |

## `useAuthStore` — `stores/auth.ts`

```ts
user: Profile | null
setUser(user)
isAdmin()            // user?.role === 'admin'
isManager()          // user?.role === 'manager'
canManageProducts()  // admin || manager
```

- Se hidrata en `app/(dashboard)/layout.tsx` tras leer `profiles`.
- Los tres helpers **nunca se llaman**. Son la base natural para gatear UI, pero la seguridad real debe
  estar en RLS.
- No se limpia al expirar la sesión, solo en `handleLogout`.

## `useCartStore` — `stores/cart.ts`

Estado: `items: CartItem[]`, `discount: number` (descuento global en **moneda**, no %), `taxRate: number`
(inicial `0.1`).

Acciones: `addItem`, `removeItem`, `updateQuantity`, `updateItemDiscount`, `setGlobalDiscount`,
`setTaxRate`, `clearCart`. Cálculos: `getSubtotal`, `getTax`, `getTotal`.

### Fórmulas (fuente de verdad actual)

```
precio(item)  = item.variant?.selling_price ?? item.product.selling_price
subtotal      = Σ ( precio(item) × cantidad − item.discount )                 // cart.ts:83-89
tax           = (subtotal − discount_global) × taxRate                        // cart.ts:91-96
total         = subtotal − discount_global + tax                              // cart.ts:98-103
```

### Particularidades y defectos [Verificado]

| # | Detalle | Ubicación | Efecto |
|---|---|---|---|
| 1 | `addItem` copia el arreglo pero **muta el objeto** existente (`newItems[i].quantity += quantity`) | `cart.ts:40` | Mutación de estado; riesgo de renders omitidos y de persistir un estado inconsistente |
| 2 | Se persiste el objeto `Product` completo dentro de cada ítem | `cart.ts` (`persist`) | El **precio queda congelado** en `localStorage`; un cambio de precio no llega al carrito guardado |
| 3 | `updateQuantity` permite 0 (`Math.max(0, q)`) sin eliminar el ítem | `cart.ts:61` | Líneas con cantidad 0 que igualmente se insertan en `order_items` |
| 4 | `clearCart` reinicia `items` y `discount`, **no** `taxRate` | `cart.ts:81` | Correcto por diseño, pero `taxRate` persiste entre sesiones |
| 5 | `taxRate` global (0.1) ignora `product.tax_rate` | `cart.ts:30,95` | Impuesto de la orden ≠ suma de impuestos de líneas ([H3](../04-auditoria/hallazgos/H3-impuestos-y-dinero.md)) |
| 6 | Sin redondeo a centavos; aritmética en `number` (float) | `cart.ts:83-103` | Descuadres de centavos entre `orders.total`, suma de líneas y `payments.amount` |
| 7 | El descuento global no tiene tope ni validación | `pos/page.tsx:333-340` | Total negativo si `discount > subtotal` |
| 8 | No se limpia al cerrar sesión | `layout.tsx:69-73` | El siguiente usuario del equipo ve el carrito anterior |
| 9 | `updateItemDiscount` existe pero **no hay UI** que lo invoque | `cart.ts:67-75` | Descuento por línea siempre 0 |
| 10 | `variant` nunca se asigna desde la UI (`addItem(product)` sin variante) | `pos/page.tsx:224` | El POS solo vende productos base; las variantes no son vendibles desde la UI |

## `useSettingsStore` — `stores/settings.ts` (sin uso)

Guarda `storeName`, `currency`, `taxRate`, `lowStockThreshold`, `theme` con persistencia. Duplica la
tabla `settings` de la BD y la pantalla `/settings` no lo usa. **Decisión pendiente**: ver
[decisiones-pendientes](../06-roadmap/decisiones-pendientes.md) (¿ajustes en BD, en store, o ambos?).

## Reglas para código nuevo

- No guardar objetos de dominio completos en stores persistidos: guardar **ids y cantidades**, y
  resolver precios contra la BD al cobrar.
- Reiniciar `cart` en logout.
- Nunca confiar en totales calculados aquí para escribir en la BD; ver [pos-checkout](../03-modulos/pos-checkout.md).
