# Módulo: Categorías

> ⚠️ **Describe el estado ANTERIOR a la etapa 1 (commit `54962b9`).** Desde entonces el navegador solo habla con `/api/v1`, RLS es por rol y la
> lógica de negocio vive en RPC de la BD: ver [API](../01-arquitectura/08-api.md) y [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md). Este documento se reescribe en el Paso 8.

> Archivo: `app/(dashboard)/categories/page.tsx` (242 líneas) · Base: commit `54962b9`

## Qué hace

CRUD de categorías con buscador. Campos: `name` (obligatorio) y `description`.

## Comportamiento

- Carga `categories` (`created_at desc`) y, en un segundo `useEffect` dependiente de `categories`
  (`:108-124`), descarga **`category_id` de todos los productos** para contar productos por categoría
  en el cliente. Escala mal: O(productos) por cada cambio de categorías.
- Crear/actualizar: `insert`/`update(formData)`. Borrar: `confirm()` + `delete`.
- Editar y borrar se muestran en la tabla; la insignia indica "N products".

## Defectos y riesgos

| # | Detalle | Efecto |
|---|---|---|
| 1 | Borrar una categoría con productos falla por FK `products.category_id` (sin `ON DELETE`) | Toast con el mensaje crudo de Postgres |
| 2 | `parent_id` (jerarquía) existe en el esquema pero no en la UI | Solo categorías planas |
| 3 | Conteo por descarga total de `products` | Reemplazar por `select category_id, count(*)` en una vista/RPC |
| 4 | Sin unicidad en `categories.name` | Se pueden crear categorías duplicadas |
| 5 | Borrado en duro sin restricción de rol | ([C1](../04-auditoria/hallazgos/C1-rls-permisivo.md)) |
| 6 | `catch (error: any)` (2 ocurrencias) | Ver [lint](../04-auditoria/lint-y-tipos.md) |

## Recomendaciones

- `UNIQUE (lower(name))` en `categories`.
- Antes de borrar, comprobar uso y ofrecer reasignar; o desactivar en lugar de borrar.
- Conteo mediante consulta agregada.
