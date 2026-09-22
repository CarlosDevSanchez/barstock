# Módulo: Clientes

> Actualizado tras la etapa 1 · `app/(dashboard)/customers/page.tsx`, `customers/[id]/page.tsx` · API `customers`, `customers/[id]` · Confianza: **[Verificado]** (`catalog.test.ts`, `rls.test.ts`, `rpc.test.ts`).

- **Quién:** cualquier usuario activo lee, crea y edita datos de contacto; **solo admin** puede borrar (sin UI de borrado).
- **Lista:** paginada, búsqueda por nombre, email o teléfono; muestra puntos de fidelidad y gasto total.
- **Alta:** nombre*, email, teléfono, dirección. `email: ''` → `null`; el email es **único** (409, sin distinguir mayúsculas porque el esquema lo pasa a minúsculas).
- **Detalle:** gasto total, nº de órdenes, puntos, estado, contacto e **historial de compras** (`GET /orders?customer_id=`). **Un cajero solo ve sus propias órdenes** (RLS), así que su historial de un cliente puede estar incompleto.

## Campos derivados (no editables)
`total_spent` y `loyalty_points` **los calcula un trigger** a partir de las órdenes `completed` (D7, sin validar): `total_spent = Σ total`, `loyalty_points = floor(total_spent)`. **Un reembolso los resta.**
Ningún cliente de la API puede escribirlos: están fuera del esquema zod y de los privilegios por columna de la BD (`rls.test.ts`). Al migrar una base existente, los valores manuales previos se **sustituyen**.

## Límites conocidos
- Sin edición ni borrado desde la UI (la API tiene `PATCH`); sin desactivar clientes desde la pantalla (el POS solo ofrece los activos).
- El selector del POS carga los 100 más recientes.
- Datos personales sin política de retención ni consentimiento (D14).
- Sin canje de puntos (D7).

Relacionados: [POS](pos-checkout.md), [Órdenes](ordenes-y-reembolsos.md).
