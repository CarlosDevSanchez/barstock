# Verificar el checkout, el stock y los formularios (pruebas manuales)

> Objetivo: convertir las hipótesis **[Por verificar]** de la auditoría en hechos. Confirman o descartan [C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md) y [M14](../04-auditoria/hallazgos/medios-y-bajos.md).
> ⚠️ Ejecutar en un proyecto **de desarrollo o staging**. No hacerlo en producción: crea y borra datos.

## Preparación

1. Proyecto con `schema.sql`, `fix_rls_policies.sql` y `seed.sql` aplicados ([setup-local](setup-local.md)).
2. Un usuario registrado (rol cualquiera).
3. Abrir el navegador con **DevTools → Network** (filtro `supabase`), y el **SQL Editor** de Supabase en otra pestaña.

## Prueba 1 — ¿Se descuenta el stock? (hipótesis C2 #2)

**Antes**, en el SQL Editor:
```sql
select p.sku, i.id as inventory_id, i.quantity, i.variant_id
from public.inventory i join public.products p on p.id = i.product_id
where p.sku = 'ELEC-001';                       -- seed: 50 unidades
select count(*) from public.inventory_transactions;   -- anotar N
```

**Acción:** en `/pos`, agregar 1 × "Wireless Mouse" y completar la orden (Cash).

**En Network**, buscar la petición de inventario del paso 4 (`GET …/inventory?…&variant_id=eq.null…`).

| Observación | Conclusión |
|---|---|
| La petición devuelve **400/404/406** (o cuerpo vacío) y **no hay** `PATCH …/inventory` ni `POST …/inventory_transactions` | **Hipótesis confirmada**: el stock no se descuenta y el toast dice éxito |
| Hay `PATCH` a `inventory` y `POST` a `inventory_transactions` con 2xx | Hipótesis descartada: el filtro funciona en su base. Actualizar C2 |

**Después**, repetir las dos consultas de "Antes":

| Resultado | Interpretación |
|---|---|
| `quantity` sigue en 50 y `count` = N | Venta registrada **sin** descuento de stock (confirmado) |
| `quantity = 49` y `count = N+1` | Descuento correcto |

**Solución provisional para comparar** (solo para probar): cambiar `.eq('variant_id', item.variant?.id || null)` por
`.is('variant_id', null)` (cuando no hay variante) y repetir; debería descontar. La solución definitiva es la RPC de C2.

## Prueba 2 — Integridad tras una venta

```sql
-- Órdenes completadas sin ítems o sin pago (huérfanas)
select o.id, o.order_number, o.total
from public.orders o
left join public.order_items i on i.order_id = o.id
where o.status = 'completed' and i.id is null;

select o.id, o.order_number
from public.orders o
left join public.payments p on p.order_id = o.id
where o.status = 'completed' and p.id is null;
```
Esperado en un sistema sano: 0 filas en ambas.

## Prueba 3 — ¿Coinciden los impuestos? (H3)

Vender 1 × "Coffee Beans" (tax 0.05) y 1 × "Wireless Mouse" (tax 0.10). Luego:
```sql
select o.order_number, o.subtotal, o.discount, o.tax as order_tax,
       sum(i.tax) as items_tax, o.total, sum(i.total) as items_total
from public.orders o join public.order_items i on i.order_id = o.id
group by o.id
order by o.created_at desc limit 5;
```
`order_tax` (tasa global 10 %) **≠** `items_tax` (tasa por producto) confirma [H3](../04-auditoria/hallazgos/H3-impuestos-y-dinero.md).

## Prueba 4 — Carrera de stock (C2 #3)

Dos pestañas/navegadores con el mismo producto (stock 1 tras ajustar a mano). Añadir 1 en ambas y pulsar "Complete Order"
casi a la vez. Resultado esperado con el diseño actual: **dos ventas completadas** para 1 unidad (o stock ≤ 0).
```sql
update public.inventory set quantity = 1 where product_id = (select id from public.products where sku='ELEC-001');
```

## Prueba 5 — Reembolso (C2 #5)

Reembolsar una orden completada. Verificar:
```sql
select status from public.orders where id = '<order id>';               -- refunded
select quantity from public.inventory where product_id = '<product id>'; -- ¿subió?
select * from public.inventory_transactions where reference_id = '<order id>'; -- ¿hay 'return'?
select * from public.payments where order_id = '<order id>';            -- sigue existiendo el pago
```
Repetir el clic rápidamente dos veces para comprobar idempotencia.

## Prueba 6 — Formularios con cadenas vacías (M14)

1. `/products` → crear un producto **sin** código de barras y con categoría; luego otro **sin** código de barras. Esperado (hipótesis): el segundo falla por `products_barcode_key`.
2. `/products` → crear un producto **sin** categoría. Esperado: error de sintaxis `uuid`.
3. `/customers` → crear dos clientes **sin** email. Esperado: el segundo falla por `customers_email_key`.

## Prueba 7 — Otros hallazgos rápidos

| Prueba | Cómo | Esperado |
|---|---|---|
| Recuperar contraseña (H4) | Pedir el correo y abrir el enlace | 404 en `/reset-password` |
| Ajustes (H4) | Cambiar la tasa y recargar `/settings` | Vuelve a los valores iniciales |
| Detalle de orden (`created_by_user`) | Abrir `/orders/<id>` de una venta real | Si sale "Order not found", el embed `profiles!orders_created_by_fkey` falla. Si carga, "Created By" muestra un UUID |
| Escalada de rol (C1) | Consola: `supabase.from('profiles').update({role:'admin'}).eq('id','<mi id>')` (solo en desarrollo) | Se aplica sin error |
| Dashboard Low Stock (M6) | Dejar ≥ 6 productos con `quantity < 10` | KPI muestra 5 |
| Reportes — "Loyalty Points" (M6) | Comparar con `customers.loyalty_points` | Muestra `floor(total_spent)` |

## Consultas de integridad

```sql
-- Stock negativo
select * from public.inventory where quantity < 0;

-- Duplicados de inventario por (producto, NULL)
select product_id, count(*) from public.inventory
where variant_id is null group by product_id having count(*) > 1;

-- Totales de orden que no cuadran con sus ítems
select o.id, o.order_number, o.total, sum(i.total) as items_total
from public.orders o join public.order_items i on i.order_id = o.id
group by o.id
having abs(o.total - (sum(i.total) - o.discount + o.tax)) > 0.01;

-- Productos sin fila de inventario
select p.sku, p.name from public.products p
left join public.inventory i on i.product_id = p.id
where i.id is null;

-- Órdenes reembolsadas cuyo stock no se repuso (comparar con la bitácora)
select o.order_number from public.orders o
where o.status = 'refunded'
  and not exists (select 1 from public.inventory_transactions t
                  where t.reference_id = o.id and t.transaction_type = 'return');
```

## Registrar resultados

Anotar fecha, entorno, commit y resultado de cada prueba en el hallazgo correspondiente
([`04-auditoria/hallazgos/`](../04-auditoria/hallazgos/)) y cambiar **[Por verificar]** por **[Verificado]** o descartar la hipótesis.
Limpiar los datos de prueba al terminar.
