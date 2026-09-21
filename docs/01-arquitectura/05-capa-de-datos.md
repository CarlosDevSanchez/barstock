# Capa de datos (acceso a Supabase)

> Base: commit `54962b9` · Confianza: **[Verificado]**

## Patrón actual

No hay capa de datos. **Cada página importa el cliente y consulta directamente**:

```ts
import { supabase } from '@/lib/supabase/client'
// dentro del componente:
const fetchX = async () => {
    const { data } = await supabase.from('tabla').select('*')
    setX(data || [])
}
useEffect(() => { fetchX() }, [])
```

Consecuencias: queries duplicadas entre páginas, tipos casteados con `as any`, cero reutilización,
errores ignorados, y lógica de negocio mezclada con JSX.

## Cliente

`lib/supabase/client.ts` (6 líneas): `createClient(NEXT_PUBLIC_SUPABASE_URL!, NEXT_PUBLIC_SUPABASE_ANON_KEY!)`
al importar el módulo. Con las variables ausentes lanza `supabaseUrl is required` en la evaluación del
módulo, lo que **rompe `next build`** al prerenderizar (ver [H5](../04-auditoria/hallazgos/H5-build-sin-env.md)).
No hay cliente de servidor ni `@supabase/ssr`.

## Queries por página

| Página | Operaciones | Tablas | Observaciones |
|---|---|---|---|
| `layout` (dashboard) | `select *` por id `.single()` | `profiles` | Sin manejo de `error` |
| `/pos` | `select *` `is_active=true`; `select *`; `select *` `is_active=true`; **insert** orders, order_items, payments, inventory_transactions; **update** inventory; `select *` inventory por producto | `products`, `categories`, `customers`, `orders`, `order_items`, `payments`, `inventory`, `inventory_transactions` | Checkout no transaccional ([C2](../04-auditoria/hallazgos/C2-checkout-no-atomico.md)) |
| `/products` | `select *, category:categories(*)` orden `created_at desc`; insert/update/delete | `products`, `categories` | Sin paginar; borrado en duro |
| `/categories` | select, insert, update, delete; `select category_id` de **todos** los productos para contar | `categories`, `products` | Conteo en cliente descargando toda la tabla |
| `/inventory` | `select *, product:products(*)` orden `quantity asc` | `inventory`, `products` | Solo lectura |
| `/orders` | `select *, customer:customers(*)` orden `created_at desc` | `orders`, `customers` | Sin paginar |
| `/orders/[id]` | orden con `customer:customers(*)` y `created_by_user:profiles!orders_created_by_fkey(*)`; ítems con `product`, `variant`; **update** `orders.status`; select/update `inventory` | `orders`, `order_items`, `inventory`, `customers`, `profiles` | El embed `profiles!orders_created_by_fkey` **[Por verificar]**: esa FK apunta a `auth.users`, no a `profiles` |
| `/customers` | select, insert | `customers` | Sin edición ni borrado |
| `/customers/[id]` | select `.single()` + órdenes del cliente | `customers`, `orders` | |
| `/suppliers` | select, insert | `suppliers` | Sin edición ni borrado |
| `/dashboard` | 2 sumas de ingresos, conteo de clientes, bajo stock (`lt quantity 10`, `limit 5`), 7 queries **secuenciales** (una por día), top productos (`limit 100`) | `orders`, `customers`, `inventory`, `order_items` | Ver [dashboard](../03-modulos/dashboard.md) |
| `/reports` | 7 queries en `Promise.all`, top productos (`limit 1000`), top clientes + **todas** las órdenes completadas | `orders`, `order_items`, `customers` | Ver [reportes](../03-modulos/reportes.md) |
| `/settings` | ninguna | — | No persiste |

Totales: **12** usos de `select('*')` y solo **4** de `limit`/`range`.

## Seguridad de las consultas

- **Sin inyección SQL [Verificado]:** no hay `rpc()`, ni SQL crudo, ni `.or()`/`.ilike()`/`.filter()` con
  texto del usuario. Las búsquedas de las pantallas filtran en memoria con `Array.filter`. PostgREST
  parametriza los valores.
- **Riesgo real = autorización, no inyección.** Cualquier query que el cliente escriba, o que un usuario
  forje desde la consola con el JWT, es aceptada si RLS lo permite (y hoy lo permite todo). Ver [C1](../04-auditoria/hallazgos/C1-rls-permisivo.md).

## Errores conocidos del patrón

| Problema | Ejemplo | Fix |
|---|---|---|
| `.eq(col, null)` no filtra `NULL` (se serializa como `col=eq.null`, verificado en `postgrest-js/dist/index.mjs:432`) | `pos/page.tsx:145`, `orders/[id]/page.tsx:71` | `.is('variant_id', null)` |
| Errores de `select` descartados (`const { data }` sin `error`) | `fetchProducts`, `fetchOrders`, `fetchInventory`… | Comprobar `error` y mostrar estado |
| `.single()` sin manejo de "0 filas" | `pos/page.tsx:141-146` | `.maybeSingle()` y tratar la ausencia como error de negocio |
| Casts `as any` para tipar embeds | `orders/page.tsx:30`, `orders/[id]/page.tsx:42-43`, `inventory/page.tsx:28` | Tipos generados (`supabase gen types typescript`) |
| Límite implícito de 1000 filas de PostgREST | `/reports` top clientes | Agregar en SQL |
| Agregaciones en el navegador | `/dashboard`, `/reports` | Vistas SQL o funciones RPC |

## Dirección propuesta

1. `lib/data/<recurso>.ts`: funciones tipadas (`listProducts`, `createOrder`…) que encapsulen
   `supabase.from(...)` y devuelvan `{ data, error }` ya validado.
2. Tipos generados desde el esquema (`supabase gen types`) en vez de `types/index.ts` manual.
3. Escrituras multi-tabla vía RPC transaccional.
4. Lecturas con paginación por rango y columnas explícitas.
5. Evaluar Server Components para lecturas iniciales con `@supabase/ssr`.
