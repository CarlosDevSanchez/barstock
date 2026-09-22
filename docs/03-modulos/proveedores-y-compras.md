# Módulo: Proveedores y compras

> Actualizado tras la etapa 3 (fase 4) · `app/(dashboard)/suppliers/page.tsx` · API `suppliers`, `suppliers/[id]` · Confianza: **[Verificado]** (`catalog.test.ts`, `rls.test.ts`).

## Proveedores (hecho)
- **Quién:** gerente y admin (los cajeros no ven la sección: `proxy.ts` los redirige, la API responde `403` y RLS devuelve 0 filas). Editar es gerente+; **eliminar es solo admin**, con `ConfirmDialog`.
- Lista paginada con búsqueda por nombre, contacto o email; alta y edición con nombre*, persona de contacto, email, teléfono, dirección y activo/inactivo (`''` → `null`).
- `PATCH /suppliers/{id}` y `DELETE /suppliers/{id}` existen en la API y en la UI (botones Editar/Eliminar en la lista).

### Borrado lógico (`deleted_at`)
`DELETE /suppliers/{id}` (solo admin) pone `deleted_at = now()` e `is_active = false`; no borra la fila. `listSuppliers`/`getSupplier` filtran `deleted_at is null`. A diferencia de `customers`, `suppliers` no tenía grants por columna (`UPDATE` de tabla completa ya otorgado a `authenticated`), así que la migración `20260923000001_soft_delete_people.sql` no necesitó un `grant` adicional para la columna nueva — solo el trigger `guard_soft_delete` (mismo que en `customers`), que exige `has_min_role('admin')` para cambiar `deleted_at`; sin él, un gerente podría borrar un proveedor directamente por PostgREST porque `suppliers_update` ya le permite hacer `UPDATE`.

## Órdenes de compra y gastos (solo esquema)
`purchase_orders`, `purchase_order_items` y `expenses` existen con sus `CHECK`, índices y RLS (gerente lee/escribe; admin borra; gastos: gerente lee y crea, admin edita y borra),
pero **no hay API ni pantalla**, y recibir una compra **no repone stock** todavía. Es trabajo de la **etapa 2** (UI de órdenes de compra y gastos).

Diseño previsto: `purchase_orders` con líneas → recibir = RPC transaccional que suma stock y registra `purchase` en `inventory_transactions`, igual que `adjust_inventory`.

Relacionados: [Inventario](inventario.md), [plan de remediación](../06-roadmap/plan-de-remediacion.md).
