# Módulo: Gastos

> Actualizado 2026-09-24 · `app/(dashboard)/expenses/page.tsx` · API `GET/POST /expenses`, `DELETE /expenses/{id}`, `POST /expense-categories` · Confianza: **[Verificado]** en local (`test/integration/expenses.test.ts`, repetido 3 veces; al quitar el rechazo de caja cerrada el test deja de recibir `P0001`).

Las compras de mercancía no se registran aquí. Van en proveedores (todavía sin pantalla de recepción).

## Quién

- Listar y crear: gerente y admin. El cajero recibe `403` en la API, redirección en `proxy.ts` y `42501` si llama a `create_expense`.
- Anular (`void_expense`): solo admin. Pone `deleted_at` y `void_reason`. No borra la fila.
- Categorías: cualquiera con rol las lee. Crearlas o editarlas es admin (`POST /expense-categories`). No hay borrado. La semilla es Arriendo, Servicios, Nómina, Insumos y Otros.

## Caja

Si el gasto lleva `cash_session_id`, el método tiene que ser efectivo y la sesión tiene que estar abierta (`FOR UPDATE`). Si está cerrada, `P0001`. Ese monto se resta del efectivo esperado de la sesión. Un gasto anulado deja de restar. Un gasto con otro método no mueve la caja.

Sin caja, el gasto igual cuenta en el reporte y se asigna a la jornada que cubre `occurred_at`, si hay una.

## Costo de lo vendido

`create_sale` y `_close_tab` copian `products.cost_price` a `order_items.unit_cost` en el momento de la venta. Cambiar el costo del producto después no cambia esa línea. El reporte usa `coalesce(unit_cost, cost_price)` para las líneas viejas, que quedaron en null.

`net_profit = gross_profit − total_discount − total_expenses`.

Relacionados: [Reportes](reportes.md), [Caja y jornada](caja-y-jornada.md), [Proveedores](proveedores-y-compras.md).
