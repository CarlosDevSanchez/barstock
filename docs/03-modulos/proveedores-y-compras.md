# Módulo: Proveedores y compras

> Actualizado tras la etapa 1 · `app/(dashboard)/suppliers/page.tsx` · API `suppliers`, `suppliers/[id]` · Confianza: **[Verificado]** (`catalog.test.ts`, `rls.test.ts`).

## Proveedores (hecho)
- **Quién:** gerente y admin (los cajeros no ven la sección: `proxy.ts` los redirige, la API responde `403` y RLS devuelve 0 filas).
- Lista paginada con búsqueda por nombre, contacto o email; alta con nombre*, persona de contacto, email, teléfono y dirección (`''` → `null`).
- `PATCH /suppliers/{id}` existe en la API; **la UI solo permite crear**. Borrado físico solo admin (sin UI).

## Órdenes de compra y gastos (solo esquema)
`purchase_orders`, `purchase_order_items` y `expenses` existen con sus `CHECK`, índices y RLS (gerente lee/escribe; admin borra; gastos: gerente lee y crea, admin edita y borra),
pero **no hay API ni pantalla**, y recibir una compra **no repone stock** todavía. Es trabajo de la **etapa 2** (UI de órdenes de compra y gastos).

Diseño previsto: `purchase_orders` con líneas → recibir = RPC transaccional que suma stock y registra `purchase` en `inventory_transactions`, igual que `adjust_inventory`.

Relacionados: [Inventario](inventario.md), [plan de remediación](../06-roadmap/plan-de-remediacion.md).
