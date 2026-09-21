# H3 — Impuestos inconsistentes y manejo de dinero con floats

| | |
|---|---|
| **Severidad** | Alto |
| **Área** | Lógica de negocio |
| **Esfuerzo** | Medio |
| **Estado** | Abierto |
| **Confianza** | **[Verificado]** en código |

## Hallazgo

### 1. Dos cálculos de impuesto que no coinciden
- **Orden:** `tax = (subtotal − descuento_global) × taxRate_global` con `taxRate = 0.1` fijo (`stores/cart.ts:30,91-96`).
- **Líneas:** `order_items.tax = precio × cantidad × product.tax_rate` (`pos/page.tsx:118`).
- El impuesto por producto del catálogo (p. ej. Coffee Beans `0.05` en el seed) **se guarda en las líneas pero no influye en el total cobrado**.
  La suma de `order_items.tax` no coincide con `orders.tax`.

### 2. Cuatro "fuentes" de la tasa, ninguna conectada a la BD
`stores/cart.ts` (`0.1`), `products/page.tsx` (valor inicial `'0.1'`), `stores/settings.ts` (`0.1`, sin uso), `lib/constants.ts` (`TAX_RATE_DEFAULT`, sin uso)
y `/settings` (`'10'`, en **porcentaje**, sin persistir). La tabla `settings` (`tax_rate = 0.10`) no se lee.

### 3. Tipo de dato insuficiente
`products.tax_rate DECIMAL(5,2)` guarda 2 decimales: una tasa de 7,5 % (`0.075`) se almacena como `0.08`. El input del formulario usa `step="0.01"`.

### 4. Aritmética en `number` (IEEE-754) sin redondeo a centavos
`getSubtotal/getTax/getTotal` no redondean; `orders.total`, la suma de líneas y `payments.amount` se redondean por separado en Postgres y pueden diferir en centavos.

### 5. Descuentos
El descuento global es un monto libre, sin tope; total negativo posible (`subtotal < discount`). El descuento por línea existe en el store pero **sin UI**.
Tampoco se distingue "impuesto sobre precio neto" de "precio con impuesto incluido".

### 6. Moneda
`$` hardcodeado y `toFixed(2)` en todas las pantallas; el selector de moneda de ajustes no afecta a nada.

## Impacto

Importes cobrados que no respetan la configuración fiscal del producto, descuadres de centavos en conciliación y reportes, y
riesgo contable/fiscal según la jurisdicción del negocio.

## Recomendación

1. **Decidir la regla fiscal** (ver [decisiones-pendientes](../../06-roadmap/decisiones-pendientes.md)): ¿tasa por producto, global o mixta? ¿precios con o sin impuesto? ¿redondeo por línea o por total?
2. Calcular impuestos **solo en el servidor** (RPC `create_sale`), leyendo tasas de la BD.
3. Almacenar tasas como `NUMERIC(6,4)` en fracción (0–1) y unificar la unidad en toda la UI (o guardar porcentaje en todas partes).
4. Trabajar en **centavos enteros** o `NUMERIC` en SQL; en el cliente, formatear con `Intl.NumberFormat` según moneda de ajustes.
5. `CHECK (total = subtotal − discount + tax)` en `orders`; `total` de `order_items` como columna generada o `CHECK`.
6. Topar y auditar descuentos (máximo por rol, motivo obligatorio sobre cierto monto).

## Criterios de aceptación

- [ ] La suma de `order_items.tax` es igual a `orders.tax` (a 0,01) en todas las ventas.
- [ ] Un producto con tasa 5 % cobra 5 % y uno con 10 % cobra 10 %, en la misma orden.
- [ ] Una tasa de 7,5 % se guarda y se lee sin redondeo.
- [ ] `orders.total`, Σ`order_items.total` y `payments.amount` coinciden al centavo.
- [ ] Un descuento mayor al subtotal es rechazado.
- [ ] La tasa por defecto se lee de `settings` (una sola fuente).
