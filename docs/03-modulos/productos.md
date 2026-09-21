# Módulo: Productos

> Archivo: `app/(dashboard)/products/page.tsx` (332 líneas) · Base: commit `54962b9`

## Qué hace

Tabla de productos con buscador y un diálogo único de alta/edición. Permite crear, editar y **borrar en duro**.

## Datos

- Carga: `products` con `category:categories(*)`, `order created_at desc`, sin paginar; y `categories` completo.
- Búsqueda en memoria por `name` y `sku` (no por barcode, a diferencia del POS).
- Columnas: producto (+descripción), SKU, categoría, costo, precio, estado (badge), acciones.

## Formulario (`formData`)

| Campo | Control | Obligatorio (HTML) | Valor inicial |
|---|---|---|---|
| `name` | Input | Sí | `''` |
| `description` | Input | No | `''` |
| `sku` | Input | Sí | `''` |
| `barcode` | Input | No | `''` |
| `category_id` | Select (sin opción "ninguna") | No | `''` |
| `tax_rate` | Input number `step=0.01` | No | `'0.1'` |
| `cost_price` | Input number `step=0.01` | Sí | `''` |
| `selling_price` | Input number `step=0.01` | Sí | `''` |
| `is_active` | **sin control en el formulario** | — | `true` |

`handleSubmit` (`:53-87`) convierte los números con `parseFloat` y envía **todo el objeto** con `...formData`.

## Defectos y riesgos [Inferido salvo indicación]

| # | Detalle | Efecto probable |
|---|---|---|
| 1 | `barcode: ''` se envía como cadena vacía, no `NULL`, a una columna `UNIQUE` | El **segundo** producto sin código de barras choca con `products_barcode_key`. Convertir `''` → `null` |
| 2 | `category_id: ''` se envía como cadena vacía a una columna `uuid` | Error `invalid input syntax for type uuid`: en la práctica la categoría es **obligatoria** aunque el formulario no lo indique |
| 3 | `parseFloat('')` → `NaN` si se evita `required` | Se enviaría `null`/`NaN`; sin validación con zod |
| 4 | `tax_rate` con `step=0.01` y columna `DECIMAL(5,2)` | No se pueden representar tasas como 7,5 % (`0.075`). Además es una **fracción** (0.1) mientras `/settings` usa **porcentaje** (10) |
| 5 | Sin control para `is_active` | No se puede desactivar un producto desde la UI, aunque el POS filtra por `is_active` y existe el badge |
| 6 | Borrado **en duro** con `confirm()` (`:89-104`) | Con ventas asociadas falla por FK (mensaje crudo de Postgres); sin ventas **borra en cascada** variantes, inventario y su bitácora |
| 7 | Crear un producto **no crea su fila de `inventory`** | El producto aparece en el POS pero no en `/inventory`, y la venta no puede descontar stock |
| 8 | Precios y costos sin validación (negativos, `selling < cost`) | Datos inválidos aceptados |
| 9 | Sin edición de variantes ni de `image_url` | Las tablas existen; la UI no |
| 10 | SKU duplicado → toast con el mensaje de Postgres | Sin validación previa |
| 11 | RLS permite a **cualquier** usuario crear/editar/borrar productos | ([C1](../04-auditoria/hallazgos/C1-rls-permisivo.md)); el helper `canManageProducts()` no se usa |

## Reglas recomendadas

- Convertir cadenas vacías en `null` antes de insertar (`barcode`, `category_id`, `description`).
- Sustituir borrado por `is_active = false` (soft delete) y añadir el control en el formulario.
- Crear el inventario inicial al crear el producto (RPC o trigger) con cantidad y umbral opcionales.
- Validar con zod compartido cliente/servidor y reforzar con `CHECK` en la BD.
- Snapshot de nombre/SKU en `order_items` para no alterar el historial al editar productos.
- Permisos: solo gerente/admin (RLS + UI).
