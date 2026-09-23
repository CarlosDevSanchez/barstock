# Módulo: Clientes

> Actualizado tras la etapa 3 (fase 4) · `app/(dashboard)/customers/page.tsx`, `customers/[id]/page.tsx` · API `customers`, `customers/[id]` · Confianza: **[Verificado]** (`catalog.test.ts`, `rls.test.ts`, `rpc.test.ts`, `sales.test.ts`, `tabs.test.ts`).

- **Quién:** cualquier usuario activo lee, crea y edita datos de contacto (incluye activar/desactivar); **solo admin** borra.
- **Lista:** paginada, búsqueda por nombre, email o teléfono; muestra puntos de fidelidad, gasto total y botones Editar (cajero+) / Eliminar (solo admin, con `ConfirmDialog`).
- **Alta y edición:** nombre*, email, teléfono, dirección, activo/inactivo (edición). `email: ''` → `null`; el email es **único** (409, sin distinguir mayúsculas porque el esquema lo pasa a minúsculas).
- **Detalle:** gasto total, nº de órdenes, puntos, estado, contacto, botón Editar e **historial de compras** (`GET /orders?customer_id=`). **Un cajero solo ve sus propias órdenes** (RLS), así que su historial de un cliente puede estar incompleto.

## Borrado lógico (`deleted_at`)
`DELETE /customers/{id}` (solo admin) pone `deleted_at = now()` e `is_active = false`; no borra la fila (el historial de órdenes sigue apuntando al cliente). `listCustomers`/`getCustomer` filtran `deleted_at is null`, así que un cliente borrado desaparece de la lista y del detalle (404) pero sus órdenes pasadas se conservan.
En la base de datos, un trigger `guard_soft_delete` (migración `20260923000001_soft_delete_people.sql`) exige `has_min_role('admin')` para cambiar `deleted_at`; sin él, cualquier cajero podría borrar un cliente directamente por PostgREST porque `customers_update` ya le permite hacer `UPDATE`. `create_sale` y `open_tab` rechazan un `customer_id` con `deleted_at` no nulo igual que rechazan uno inactivo o inexistente (mensaje `Customer not available`).

## Campos derivados (no editables)
`total_spent` y `loyalty_points` **los calcula un trigger** a partir de las órdenes `completed` (D7, sin validar): `total_spent = Σ total`, `loyalty_points = floor(total_spent)`. **Un reembolso los resta.**
Ningún cliente de la API puede escribirlos: están fuera del esquema zod y de los privilegios por columna de la BD (`rls.test.ts`). Al migrar una base existente, los valores manuales previos se **sustituyen**.

## Límites conocidos
- El selector del POS carga los 100 más recientes.
- Datos personales sin política de retención ni consentimiento (D14).
- Sin canje de puntos (D7).
- Sin restaurar (undelete) desde la UI; solo un admin podría limpiar `deleted_at` directamente en la base.

Relacionados: [POS](pos-checkout.md), [Órdenes](ordenes-y-reembolsos.md).
