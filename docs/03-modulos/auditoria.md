# Módulo: Auditoría

> Nuevo en la etapa 2 · `app/(dashboard)/audit/page.tsx` · API `audit` (solo `GET`) · Servicio `services/audit.ts` ·
> Migración `supabase/migrations/20260926000001_audit_log.sql` · Confianza: **[Verificado]** (`test/integration/audit.test.ts`).

- **Quién:** solo **admin** (`proxy.ts` redirige a `/dashboard`, la API responde `403`, y RLS devuelve 0 filas a cualquier otro rol).
- **Qué registra:** escrituras (`insert`/`update`/`delete`) en las tablas listadas abajo y eventos de sesión (`login`,
  `login_failed`, `logout`, `invite`, `password_reset`). Cubre tanto los CRUD directos como las escrituras que pasan por
  una RPC (`create_sale`, `adjust_inventory`, las de cuentas abiertas), porque el trigger va en la tabla, no en la ruta de
  escritura.
- **Qué NO registra:** `order_items`, `payments` e `inventory_transactions` (redundante: la venta ya queda en `orders`, y
  el ajuste en `inventory` con su motivo).

## Esquema (`audit_log`)

| Columna | Contenido |
|---|---|
| `occurred_at` | Cuándo (índice `desc` para el listado) |
| `actor_id` / `actor_email` / `actor_role` | Quién. **Sin FK** a `profiles`: el registro sobrevive a que se borre el usuario. `actor_email`/`actor_role` son una instantánea del momento, no una referencia en vivo. `actor_id` nulo + `actor_email = 'system'` significa una escritura sin JWT (migración, seed, `service_role`, editor SQL) |
| `action` | Una de `insert`, `update`, `delete`, `login`, `login_failed`, `logout`, `invite`, `password_reset` |
| `entity` / `entity_id` | Tabla (o `auth`) y el `id` de la fila |
| `changes` | Fila nueva en un alta, fila vieja en un borrado; en una edición, **solo las columnas que cambiaron**, como `{"columna": {"before": ..., "after": ...}}`. Nunca incluye `updated_at`. Una edición que no cambia nada no genera fila |
| `source` | `db` (sin JWT) o `api` (con sesión) |

Tablas con el trigger genérico (`audit_row_change`): `products`, `categories`, `promotions`, `promotion_items`,
`inventory`, `orders`, `customers`, `suppliers`, `settings`, `profiles`, `tabs`, `tab_items`, `tab_payments`.

## Inmutabilidad

Nadie edita ni borra un registro, en tres capas independientes (documentado también en
[03-rls-y-politicas](../02-base-de-datos/03-rls-y-politicas.md) y
[04-triggers-y-funciones](../02-base-de-datos/04-triggers-y-funciones.md)):

1. **RLS:** solo existe una política `SELECT` (`audit_log_select`, admin). No hay política de escritura.
2. **Privilegios de tabla:** `INSERT/UPDATE/DELETE/TRUNCATE` revocados a `authenticated`/`anon`.
3. **Triggers `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE`** que lanzan `raise exception` siempre. Esta es la capa que
   de verdad bloquea a `service_role` y al editor SQL, que la capa 2 sola no detiene.

Verificado a mano contra la base local: un `UPDATE`/`DELETE`/`TRUNCATE` con la `service_role` key falla con
`audit_log is append-only`, igual que con una sesión de admin.

## Eventos de sesión

| Evento | Quién lo registra | Notas |
|---|---|---|
| `login` | El propio usuario, tras un `signInWithPassword` correcto | Vía RPC `log_auth_event`; el actor es siempre `auth.uid()`, nunca un parámetro |
| `login_failed` | El servidor, con el cliente `service_role` | Antes de la sesión: `actor_id` nulo, `actor_email` = el correo intentado |
| `logout` | El propio usuario, **antes** de `signOut()` | Después de cerrar sesión ya no hay JWT que adjuntar al registro |
| `invite` | El admin que invita, con su propia sesión | El cliente `service_role` usado para crear el usuario invitado no tiene `auth.uid()` |
| `password_reset` | El propio usuario, tras `updateUser({ password })` | Cubre tanto el reset por email como el cambio tras aceptar una invitación |

Un fallo al registrar un evento de sesión **no rompe el login/logout/invite/reset**: se escribe en el log del servidor y
se sigue (`console.error('[audit] ...')`). Una escritura de negocio es distinta: el trigger corre en la misma
transacción, así que si falla, la escritura falla con él.

## UI

- Filtros: usuario, acción, entidad y rango de fechas.
- Columnas: fecha y hora (zona de `settings.timezone`), usuario, rol y acción.
- Un diálogo de solo lectura muestra el `changes` de la fila (JSON crudo); no hay botón de editar ni de borrar en ninguna
  fila.

## Límites conocidos

- **Retención:** la tabla crece sin límite y nadie puede borrarla ni archivarla desde la aplicación (decisión pendiente,
  ver [decisiones-pendientes](../06-roadmap/decisiones-pendientes.md), D-audit).
- El diálogo de cambios muestra JSON crudo, no un diff visual columna por columna.
- No hay exportación (CSV/PDF) del listado.
