# Módulo: Categorías

> Actualizado tras la etapa 1 · `app/(dashboard)/categories/page.tsx` · API `categories`, `categories/[id]` · Confianza: **[Verificado]** (`catalog.test.ts`).

- **Quién:** todos leen; **gerente/admin** crean, renombran y borran (botones ocultos al cajero; la API responde `403`).
- **Lista** paginada con búsqueda por nombre y **`product_count`** por categoría (antes se contaba en el cliente descargando todos los productos).
- **Formulario:** nombre* (≤ 120) y descripción (≤ 1000, `''` → `null`).
- **Borrado:** `ConfirmDialog`; borrado físico. Si la categoría tiene productos, la clave foránea devuelve **409** ("The record is referenced by, or refers to, another record") y el toast lo dice.
- `parent_id` (jerarquía) existe en el esquema y la API lo acepta, pero **la UI no lo expone**.

Límites: sin orden manual, sin reasignar productos al borrar. Relacionados: [Productos](productos.md).
