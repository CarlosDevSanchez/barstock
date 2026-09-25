# Módulo: Jornada y cajas

> Actualizado 2026-09-24 · migración `20261003000001_business_days_cash.sql` · página `/cash` · Confianza: **[Verificado]** en local (`test/integration/business-days.test.ts`, incluido el índice único de una jornada abierta).

Una **jornada** es el día de operación del negocio. Una **caja** (`cash_registers`) es un cajón; la migración deja una, «Caja 1». Una **sesión** es ese cajón abierto dentro de una jornada, con fondo y uno o varios responsables.

## Reglas

- Se puede vender **sin** jornada y **sin** caja. Esas órdenes quedan con `business_day_id` y `cash_session_id` nulos (fuera de jornada / sin caja). El POS solo avisa; no bloquea el cobro.
- Cualquier rol, incluido el cajero, abre y cierra la jornada y la caja. Ajustar una jornada (`adjust_business_day`) es solo admin (`42501` si no).
- Solo puede haber **una jornada abierta**. El índice único parcial `business_days_one_open_idx` es la barrera de concurrencia: la segunda apertura recibe «A business day is already open».
- Una caja no puede tener dos sesiones abiertas a la vez.
- Una jornada abierta más de 24 horas se cierra sola (`close_kind = 'auto'`, `needs_review`) al abrir otra, al cobrar, al pagar una cuenta o al llamar `GET /api/cron/tick`. Las sesiones que sigan abiertas se cierran sin conteo (`counted_cash` nulo, `difference` nulo, `needs_review`).
- El cron es `0 14 * * *` (Vercel Hobby, una vez al día). Sin `CRON_SECRET` la ruta responde 503; sin el bearer correcto, 401. `proxy.ts` deja pasar `/api/cron` sin sesión para que la ruta vea el bearer.
- Tolerancia de arqueo: `settings.cash_count_tolerance` = **0**. Cualquier diferencia distinta de cero marca `needs_review`. El fondo por defecto (`default_opening_float`) es 0.
- El fondo **no** es ingreso. El reporte de jornada suma órdenes `completed`, no el fondo.

## Efectivo esperado

`opening_float` + pagos en efectivo de la sesión + efectivo de cuentas aún abiertas − retiros + ingresos − efectivo de órdenes de esa sesión ya reembolsadas.

El pago de una cuenta no se cuenta dos veces: mientras la cuenta sigue abierta está solo en `tab_payments`; al cerrarla, la copia en `payments` conserva `cash_session_id` y la cuenta deja de sumarse. Un gasto en efectivo de esa caja (no anulado) se resta. Un gasto con otro método no mueve el efectivo.

`expected_cash` guardado al cerrar es una foto. El resumen en vivo usa el estado actual (un reembolso posterior baja el esperado en pantalla, no el número ya guardado) — salvo que la caja ya esté cerrada: entonces `cash_session_summary` devuelve siempre la foto guardada, nunca un recálculo.

## Arqueo a ciegas (R-1)

Mientras la caja está **abierta**, un cajero (incluido el dueño de la caja) no ve `expected_cash` **ni ningún
componente que permita derivarlo por suma** (`cash_sales`, `open_tab_cash`, `deposits`, `withdrawals`,
`refunded_cash`, `expenses`, `purchases`): `cash_session_summary` solo devuelve `opening_float`. Un gerente+
siempre ve todo, en vivo. Al cerrar, `close_cash_session` devuelve `{expected_cash, counted_cash, difference,
needs_review}` en la respuesta — así el cajero se entera de la diferencia justo después de contar, no antes.
`getCashDesk` (la respuesta de `GET /business-days/current` que usan `/cash`, `/expenses` e `/inventory`) solo
llama `cash_session_summary` para la caja del **propio** cajero: para las cajas de otros cajeros abiertas en la
misma jornada, la muestra sin `expected_cash` y sin llamar la RPC (que lanzaría `42501` si la llamara).

## Reembolso de una venta en efectivo

El monto se resta de la caja **donde se cobró originalmente** (`payments.cash_session_id`; solo puede haber un
pago en efectivo por orden, los métodos duplicados están bloqueados), **si esa caja sigue abierta** — sin
importar qué caja tenga abierta quien hace el reembolso (un gerente normalmente no tiene ninguna). Si la caja
original ya cerró, no se resta de ninguna caja y la orden queda `refund_after_close = true` para que alguien lo
revise; el número ya reconciliado de esa caja cerrada no cambia.

## Anular un gasto o una compra en efectivo (R-2)

Si la caja de ese gasto/compra sigue **abierta**, el monto vuelve al esperado de inmediato, como antes.
Si ya está **cerrada**, el monto sigue restado — no cambia lo ya reconciliado — y la fila queda marcada
`voided_after_close = true`.

## API

| Método | Ruta | Rol |
|---|---|---|
| GET | `/api/v1/business-days/current` | cajero+ (también corre el autocierre) |
| POST | `/api/v1/business-days` | cajero+ |
| POST | `/api/v1/business-days/:id/close` | cajero+ |
| PATCH | `/api/v1/business-days/:id` | admin |
| GET | `/api/v1/business-days` | gerente+ |
| GET | `/api/v1/business-days/:id` | gerente+ (`business_day_report`) |
| GET/POST | `/api/v1/cash-registers` | leer cajero+; crear admin |
| POST | `/api/v1/cash-sessions` | cajero+ |
| GET | `/api/v1/cash-sessions/:id` | cajero+ |
| POST | `/api/v1/cash-sessions/:id/movements` | responsable de esa sesión o gerente+ |
| POST | `/api/v1/cash-sessions/:id/close` | responsable de esa sesión o gerente+ |

Las escrituras de jornada y sesión son RPC. `cash_registers` se inserta por RLS (solo admin). El resto de tablas nuevas no tiene política de escritura.

## Pantallas

- `/cash` (nav **Jornada**; el ítem «Caja» del menú sigue siendo el punto de venta). Historial para gerente+. «Ajustar» solo admin y solo si `needs_review`.
- El POS muestra «Sin jornada abierta» o «No eres responsable de ninguna caja».
- El panel del admin enlaza a `/cash` si hay jornadas por revisar.
- Reportes: «Por fechas» (el `sales_report` de siempre) o «Por jornada».

Relacionados: [POS](pos-checkout.md), [Cuentas abiertas](cuentas-abiertas.md), [Reportes](reportes.md).
