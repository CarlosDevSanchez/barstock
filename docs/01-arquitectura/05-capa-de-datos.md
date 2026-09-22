# Capa de datos

> Actualizado tras la etapa 1. Confianza: **[Verificado]**. Contrato de endpoints en [API](08-api.md); modelo en [`02-base-de-datos/`](../02-base-de-datos/01-esquema-tablas.md).

## Quién habla con la base de datos

Solo el servidor. El navegador usa `lib/api/*` (fetch a `/api/v1`); las páginas no importan `@supabase/*` (lo impone el lint).

```
Route Handler ──▶ servicio (lib/server/services/<recurso>.ts) ──▶ cliente Supabase del request (JWT del usuario) ──▶ RLS
                                                              └──▶ RPC (create_sale, refund_order, adjust_inventory, dashboard_summary, sales_report)
```

Hay **dos** clientes en el servidor:

| Cliente | Archivo | Uso |
|---|---|---|
| Ligado a las cookies del request (`SupabaseClient<Database>`) | `lib/server/supabase.ts` | **Todos** los servicios. Aplica RLS con el JWT del usuario |
| `service_role` | `lib/server/supabase-admin.ts` | **Solo** `auth.admin` en `services/users.ts` (invitar). Salta RLS: nunca se pasa a otros servicios |

## Patrón de un servicio

```ts
export async function updateProduct(supabase: AppSupabaseClient, id: string, patch: ProductUpdate) {
    const { data, error } = await supabase.from('products').update(patch).eq('id', id).is('deleted_at', null).select().maybeSingle()
    assertNoError(error)                       // supabase-js no lanza: hay que comprobar { error }
    if (!data) throw notFound('Product not found')   // RLS: un UPDATE/DELETE bloqueado afecta 0 filas SIN error
    return data
}
```

Reglas del patrón:

- **Comprobar siempre `{ error }`** (`assertNoError` lo convierte en un `AppError` con el estado HTTP correcto). `try/catch` no basta.
- **0 filas = 404**: RLS no lanza error al bloquear un `UPDATE`/`DELETE`; el servicio debe distinguirlo con `.maybeSingle()`.
- **Nunca se confía en lo que envía el cliente para escribir**: precio, impuesto, totales y permisos los decide la BD; los esquemas zod solo dejan pasar columnas escribibles.
- Los tipos vienen de `types/database.ts` (**generado**, `bun run db:types`). Cuidado: supabase-js infiere el tipo del `select` a partir del **literal**; concatenar strings
  (`'a' + 'b'`) lo degrada a `string`.
- Sin `any`: `unknown` en los `catch`; las respuestas de RPC que devuelven JSON se validan con zod (`lib/validation/reports.ts`).

## Errores

`lib/server/errors.ts` traduce códigos de Postgres/PostgREST a estados HTTP **sin filtrar mensajes crudos** (`23505` → 409, `23503` → 409, `23514`/`23502` → 422,
`22P02` → 400, `42501` → 403, `PGRST116`/`P0002` → 404, `PGRST301` → 401). Excepción deliberada: `P0001` (los `RAISE EXCEPTION` de nuestros RPC, escritos para el usuario:
`Insufficient stock for "X"`) se devuelve como 422 con su mensaje.

## Listas, búsqueda y paginación

- Parámetros comunes `?page&pageSize&q` (`pageSize` ≤ 100, por defecto 25) validados por `paginationSchema`; `pageRange()` da el rango de `.range(from, to)` y `count: 'exact'` el total.
- La búsqueda usa `.or('col.ilike.%término%,…')` con el término pasado por `sanitizeSearch()` (quita `, ( ) " \ % * _`): sin esto la entrada del usuario podría inyectar filtros PostgREST.
- Excepción: `inventory?low=true` compara dos columnas (`quantity <= low_stock_threshold`), que PostgREST no expresa; se filtra en memoria sobre hasta 1000 filas y `summary` se calcula sobre todo el conjunto.

## Escrituras multi-tabla: RPC

| RPC | Servicio | Garantías |
|---|---|---|
| `create_sale` | `services/sales.ts` | Una transacción; precio e impuesto de la BD; stock atómico y nunca negativo; líneas ordenadas contra deadlocks |
| `refund_order` | `services/orders.ts` | Bloqueo de la orden; idempotente; repone stock una sola vez; registra el movimiento |
| `adjust_inventory` | `services/inventory.ts` | Motivo obligatorio; nunca negativo; registra el movimiento |
| `dashboard_summary`, `sales_report` | `services/reports.ts` | Agregación en SQL con el RLS del que llama; respuesta validada con zod |

Detalle y pruebas de concurrencia en [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md) y [testing](../05-guias/testing.md).

## Borrado
Productos: **borrado lógico** (`deleted_at`, `is_active = false`): el historial de ventas sigue apuntando al producto; el SKU queda reservado. Categorías: borrado físico (las claves
foráneas devuelven 409 si tiene productos). Órdenes, pagos y stock **no se borran** (sin privilegios de escritura); los usuarios se **desactivan**.

## Tipos
`types/database.ts` (generado) → `types/index.ts` (alias y relaciones; nunca formas de tabla escritas a mano). Tras cada migración: `bun run db:types`.
Los enums de la BD y los del código (`USER_ROLES`, `PAYMENT_METHODS`) se comprueban entre sí en las pruebas.
