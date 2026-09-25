# Módulo: Notificaciones (alertas de personal)

> Fase F + correcciones de [H6](../04-auditoria/hallazgos/H6-revision-adversarial-a-f.md) · migraciones
> `20261005000004_notifications.sql`, `20261006000001_fix_security.sql` (S2, allowlist push), `20261006000005_fix_outbox.sql`
> (F2, reclamo de filas atascadas), `20261006000007_fix_adversarial_review.sql` (`attempts` en el reclamo),
> `20261006000008_fix_h6_pending.sql` (F3, U5, E3) · servicio `lib/server/services/notifications.ts` ·
> Confianza: **[Verificado]** (`test/integration/notifications.test.ts`); push/email reales no verificados sin
> claves de Resend/VAPID.

## Qué hace

Encola alertas en `notification_outbox` y las entrega **mejor esfuerzo** (email Resend y/o Web Push) a
administradores activos (y a gerentes si `settings.low_stock_notify_managers` es verdadero). Correo y push son
**dos canales independientes** (U6, ver [variables de entorno](../05-guias/variables-de-entorno.md)): sin ninguna
variable configurada, `dispatchOutbox` no reclama filas del outbox; con solo un canal configurado, entrega por
ese canal y deja pendiente lo que dependa del otro.

## Orígenes

| Evento | Cómo entra al outbox |
|---|---|
| Stock cruza a `quantity <= low_stock_threshold` | Trigger `inventory_low_stock_notify` (una vez por tramo bajo; `stock_alert_state` evita duplicados) |
| Autocierre de jornada (> 24 h) | `_auto_close_stale_business_days` inserta `business_day_auto_closed` |
| Cuenta por cobrar vencida con recordatorio | Cron llama `_enqueue_due_receivables` (máx. una vez por orden mientras no haya una fila anterior sin procesar, no solo "una vez por día local") |

Tras ventas, ajustes de inventario, ítems/pagos de cuentas y el cron, los handlers exitosos llaman
`afterResponse(() => dispatchOutbox())` (F1: la promesa se devuelve a `after()`, no se dispara con `void`).

## Reclamo de filas y reintentos (F2, F3)

- `_claim_outbox(p_limit)` toma filas `processed_at is null and attempts < 5`, con `claimed_at is null` **o**
  reclamadas hace más de 10 minutos (una fila que se reclamó y el proceso murió antes de terminar no queda
  bloqueada para siempre) y suma 1 a `attempts` en el mismo `update` del reclamo.
- **F3, entrega por destinatario:** cada fila del outbox lleva `payload.delivered_to` (array de `profiles.id`),
  actualizado por la RPC interna `_mark_outbox_delivery(p_ids, p_recipient)`. Un reintento solo envía a los
  destinatarios que faltan en `delivered_to` de alguna fila del lote — no reenvía a quien ya lo recibió. Una fila
  se marca `processed_at` solo cuando **todos** los destinatarios actuales aparecen en su `delivered_to`; si no,
  se trata como fallo parcial (`markFailure`, mismo mecanismo que un fallo total) y vuelve a intentarse.
- `sendPush` recorre **todas** las suscripciones del usuario en vez de cortar en la primera que falla: acumula
  errores, borra las que devuelven 404/410 (suscripción muerta) y solo relanza si queda algún error real.
- `_purge_outbox()` (E3) borra filas con `processed_at` de hace más de 30 días; la llama el cron diario
  (`app/api/cron/tick/route.ts`), de forma best-effort (un fallo del purgado no bloquea el resto del tick).

## Seguridad push (S2)

`endpoint` de una suscripción debe ser `https:` y su host debe estar en la allowlist de servicios de push
soportados (`lib/validation/notifications.ts`): `fcm.googleapis.com`, `*.push.apple.com`,
`updates.push.services.mozilla.com`/`*.push.services.mozilla.com`, `*.notify.windows.com`. Se valida al guardar
la suscripción **y** de nuevo al despachar (la allowlist puede haberse estrechado desde que se guardó). Borrar una
suscripción (`DELETE`) **no** aplica la allowlist: una suscripción de un host que dejó de estar soportado debe
poder eliminarse igual.

## Equipo compartido (U5)

Un dispositivo compartido (caja, tablet) no debe seguir enviando push a la sesión anterior ni fallar al
suscribirse un segundo usuario:

- `register_push_subscription(endpoint, p256dh, auth, user_agent)` hace upsert por `endpoint` y **reasigna**
  `user_id` al usuario que llama, en vez del insert directo anterior (que daba 409 si el `endpoint` ya
  pertenecía a otro usuario). `POST /api/v1/me/push-subscriptions` la usa.
- Al cerrar sesión, el cliente desuscribe la suscripción del navegador (`pushManager.getSubscription()?.unsubscribe()`
  + `DELETE` al servidor) **antes** de llamar a `auth/logout`.
- El interruptor de push en el menú de cuenta se muestra activado solo si `notify_push` **y** el navegador tiene
  de verdad una suscripción activa (`reg.pushManager.getSubscription()`) — no solo la preferencia guardada, que
  puede venir de otro dispositivo.
- `public/sw.js` escucha `pushsubscriptionchange` (el navegador puede rotar el endpoint en cualquier momento) y
  vuelve a suscribirse + reenvía al servidor, mejor esfuerzo.

## Preferencias y push

- `profiles.notify_email` / `notify_push` (default `true`); solo cambiables con RPC `set_notification_prefs`.
- `POST`/`DELETE /api/v1/me/push-subscriptions`, `PATCH /api/v1/me/notifications`, `GET /api/v1/me/push-key`.
- UI: menú de cuenta («Notificaciones») y campana en la barra superior (cuenta `low_stock_count` de
  `GET /dashboard`, no una carga completa del inventario; se refresca al cambiar de ruta).

## Seguridad

`notification_outbox` y `stock_alert_state`: RLS sin políticas, solo `service_role` / funciones definer.
`push_subscriptions`: cada usuario solo ve/borra las suyas directamente; el registro/reasignación pasa por la
RPC `security definer` de arriba, no por un insert directo.
