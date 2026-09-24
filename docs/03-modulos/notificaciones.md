# Módulo: Notificaciones (alertas de personal)

> Fase F · migración `20261005000004_notifications.sql` · servicio `lib/server/services/notifications.ts` ·
> Confianza: **[Por verificar]** (pruebas de integración escritas; no ejecutadas en este worktree porque las
> columnas de cobros de la fase E aún no están en la BD local compartida).

## Qué hace

Encola alertas en `notification_outbox` y las entrega **mejor esfuerzo** (email Resend y/o Web Push) a
administradores activos (y a gerentes si `settings.low_stock_notify_managers` es verdadero). Sin las variables
`RESEND_*` / `VAPID_*` la app sigue funcionando: `dispatchOutbox` omite el canal que falte.

## Orígenes

| Evento | Cómo entra al outbox |
|---|---|
| Stock cruza a `quantity <= low_stock_threshold` | Trigger `inventory_low_stock_notify` (una vez por tramo bajo; `stock_alert_state` evita duplicados) |
| Autocierre de jornada (> 24 h) | `_auto_close_stale_business_days` inserta `business_day_auto_closed` |
| Cuenta por cobrar vencida con recordatorio | Cron llama `_enqueue_due_receivables` (máx. una vez por orden y día local de la tienda) |

Tras ventas, ajustes de inventario, ítems/pagos de cuentas y el cron, los handlers exitosos llaman
`after(() => dispatchOutbox())`.

## Preferencias y push

- `profiles.notify_email` / `notify_push` (default `true`); solo cambiables con RPC `set_notification_prefs`.
- `POST`/`DELETE /api/v1/me/push-subscriptions`, `PATCH /api/v1/me/notifications`, `GET /api/v1/me/push-key`.
- UI: menú de cuenta («Notificaciones») y campana en la barra superior → `/inventory?low=1`.

## Seguridad

`notification_outbox` y `stock_alert_state`: RLS sin políticas, solo `service_role` / funciones definer.
`push_subscriptions`: cada usuario solo ve/inserta/borra las suyas.
