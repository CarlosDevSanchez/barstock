# PWA y modo offline

> Nuevo en la etapa 2; instantánea del POS (F1) y cola de ventas offline (F3) añadidas después · Confianza:
> **[Verificado]** (`test/components/use-online-status.test.tsx`, `test/components/connection-status.test.tsx`,
> `test/components/install-banner.test.tsx`, `lib/api/client.test.ts`, `test/components/use-pos-snapshot.test.tsx`,
> `test/components/pos.test.tsx`, `test/integration/pos-snapshot.test.ts`, `lib/offline/db.test.ts`,
> `lib/offline/outbox.test.ts`, `lib/offline/sync.test.ts`, `test/components/use-outbox-sync.test.tsx`,
> `e2e/offline.e2e.ts`).

La app es instalable (escritorio y Android/iOS) y sigue mostrando las **vistas ya visitadas** sin red, con avisos claros
de conexión. El POS además mantiene una instantánea propia del catálogo (F1, ver más abajo) para poder navegar y
buscar productos sin red aunque no se haya visitado esa búsqueda exacta antes, y **ya puede cobrar sin red** (F3): la
venta se encola y se sincroniza sola al volver la conexión. Es la única escritura habilitada sin red; el resto
(cuentas abiertas, ajustes de inventario, reembolsos) sigue deshabilitado. Diseño completo en
[offline-y-sincronizacion](../06-roadmap/offline-y-sincronizacion.md) (D16 en
[decisiones-pendientes](../06-roadmap/decisiones-pendientes.md)).

## Piezas

| Archivo | Función |
|---|---|
| `app/manifest.ts` | Manifest del navegador: `start_url: '/pos'`, `display: 'standalone'`, iconos. Servido en `/manifest.webmanifest` |
| `public/icons/*`, `app/apple-icon.png` | **Iconos provisionales** (generados desde el nombre y el color de marca): sustituir por el logo real |
| `public/sw.js` | Service worker escrito a mano (sin Serwist: su integración con Turbopack/Next 16 es **[Por verificar]**). Versionado con `CACHE_VERSION`; solo intercepta `GET`, nunca escrituras |
| `public/offline.html` | Página estática bilingüe (fallback de navegación sin red ni caché) |
| `components/pwa/sw-register.tsx` | Registra el SW (**solo en producción**: en `next dev` cachear el output de Turbopack rompería el hot reload). Muestra un toast "Actualizar" cuando hay una versión nueva |
| `components/pwa/install-banner.tsx` | Aviso en `/login` para instalar la PWA: botón nativo si el navegador dispara `beforeinstallprompt` (Chrome/Edge/Android); pasos breves en iOS Safari. Se oculta en modo `standalone` y si el usuario lo descarta (`localStorage`) |
| `components/connection-status.tsx` | Badge siempre visible + toast persistente al perder la red + toast de éxito al volver, en el header del layout ([sidebar](../03-modulos/) via `app-shell.tsx`) |
| `hooks/use-online-status.ts` | `useSyncExternalStore` sobre `navigator.onLine` y los eventos `online`/`offline` |
| `components/pwa/offline-disabled-button.tsx` | Botón que se deshabilita solo (con tooltip) mientras no hay red: usado en cobrar, añadir/pagar cuenta y ajustar inventario |
| `lib/pwa/clear-cache.ts` | Borra las cachés de HTML/API al cerrar sesión (dispositivo compartido) |
| `lib/offline/db.ts` | Envoltorio mínimo de IndexedDB (dos stores: `snapshot`, `outbox`). No-op si `indexedDB` no existe (pestaña privada, entorno de test) |
| `hooks/use-pos-snapshot.ts` + `app/api/v1/pos/snapshot/route.ts` | Instantánea del catálogo del POS (F1, ver abajo) |
| `lib/offline/outbox.ts` + `lib/offline/sync.ts` + `hooks/use-outbox-sync.ts` | Cola de ventas offline y motor de sincronización (F3, ver abajo) |

## Instantánea del catálogo del POS (F1)

`GET /api/v1/pos/snapshot` (`lib/server/services/pos.ts`) devuelve de una vez los productos y promociones activos, las
categorías y los clientes activos, en la misma forma que ya usan `/products` y `/promotions` (sin paginar; pensado
para el catálogo completo de un solo negocio, tope de 2000 filas por tabla). `hooks/use-pos-snapshot.ts` la pide al
montar el POS, cada 5 minutos y al volver la conexión, y la persiste en IndexedDB (`lib/offline/db.ts`) para que esté
disponible de inmediato en la siguiente carga, incluso sin red.

`app/(dashboard)/pos/page.tsx` usa esta instantánea **solo mientras `useOnlineStatus()` es `false`**: la búsqueda y el
filtro por categoría pasan a hacerse en memoria contra el último catálogo guardado, en vez de pedir `/products` con
paginación. Corrige el error #4 del diseño original de la cola offline (la caché del service worker está indexada por
URL+query exacta: una búsqueda nueva sin red no tenía de dónde salir). La instantánea respalda **navegar, armar el
carrito y decidir si cobrar sigue permitido sin red** (`generated_at` + `settings.offline_max_hours`, ver F3 abajo);
el cálculo final de precios/stock sigue siendo responsabilidad exclusiva del servidor, al sincronizar. Ver F1 en
[offline-y-sincronizacion](../06-roadmap/offline-y-sincronizacion.md).

El logout borra la instantánea (`idbClearSnapshot`, junto con `clearOfflineCaches`): es un dispositivo compartido, no
debe quedar el catálogo (ni los clientes, que incluyen email/teléfono) de la sesión anterior. La cola de ventas
(`outbox`, F3) **no** se borra: pertenece al usuario, no al dispositivo.

## Cola de ventas offline y sincronización (F3)

Desde F3, cobrar funciona sin red: es la única escritura habilitada offline (cuentas abiertas, ajustes de inventario
y reembolsos siguen deshabilitados con `OfflineDisabledButton`).

- **`lib/offline/outbox.ts`** guarda cada venta encolada (`OutboxEntry`) en el store `outbox` de `lib/offline/db.ts`,
  con el mismo `client_ref` (UUID) que ya generaba el POS como clave de idempotencia (F0) — también sirve de clave
  del registro, así un doble clic nunca duplica la entrada. Estados:
  `pending → syncing → synced | synced_with_issues | rejected | paused_auth`.
- **`lib/offline/sync.ts`** (`runSync`) envía la cola: dentro de `navigator.locks` cuando el navegador lo soporta
  (si no, corre igual — la idempotencia protege ante una carrera de todas formas), FIFO, una entrada a la vez, y
  solo las que pertenecen a la sesión activa (`GET /me`). Cada envío es `POST /sales` con
  `Idempotency-Key: client_ref` y `occurred_at`/`expected_total` — ahí `create_sale` hace los cálculos reales (F2).
  Un 401 pausa esa entrada sin navegar (`apiGet`/`apiPost` aceptan `{ redirectOnUnauthorized: false }`, así no se
  dispara `handleUnauthorized`); un rechazo de negocio (4xx) la marca `rejected` y sigue con las demás; sin red o
  un 5xx la deja `pending` con reintento exponencial (tope 30 min) y corta el resto de la cola para ese intento.
- **`hooks/use-outbox-sync.ts`**, montado una vez en `components/app-shell.tsx`, dispara `runSync()` al montar, en
  cada evento `online` y cada 60 s (barato cuando la cola está vacía).
- El botón "Checkout"/"Complete Order" del POS (`components/pos/cart-sheet.tsx`) ya **no** usa
  `OfflineDisabledButton`: sin red sigue habilitado, salvo que la instantánea esté fuera de la ventana
  `settings.offline_max_hours` (o nunca se haya cargado), caso en el que se deshabilita con un tooltip explicando
  por qué.
- Cerrar sesión con ventas sin sincronizar muestra un aviso (`ConfirmDialog` en `components/shell/account-menu.tsx`)
  explicando que se conservan y se envían solas al volver a entrar.

Detalle completo (formato de las entradas, reglas de reintento, pruebas) en F3 de
[offline-y-sincronizacion](../06-roadmap/offline-y-sincronizacion.md). Falta la parte de UI (F4): un contador y una
lista en un centro de sincronización, marcar el ticket impreso como "PROVISIONAL", y una pantalla de revisión de
gerente para las ventas con `sync_issues`.

## Pantalla completa (modo standalone)

`app/layout.tsx` fija `viewport: { viewportFit: 'cover', width: 'device-width', initialScale: 1, themeColor: [...] }`
(claro/oscuro) y `metadata.appleWebApp.statusBarStyle: 'black-translucent'`. `viewportFit: 'cover'` deja que el contenido
ocupe también el área de los "notches"/home indicator; `black-translucent` hace que la barra de estado de iOS se dibuje
encima del contenido en vez de dejar una franja blanca. Por eso `TopBar`, `BottomNav`, el FAB y las hojas inferiores
(`components/shell/*`, `components/fab.tsx`, `components/ui/dialog.tsx`) añaden `env(safe-area-inset-top)` /
`env(safe-area-inset-bottom)` a mano en vez de confiar en el padding del navegador. Detalle del shell responsive en
[UI y diseño](06-ui-y-diseno.md).

## Estrategia del service worker

| Petición | Estrategia |
|---|---|
| `install` | Precache de `/offline.html` y los iconos. **No** llama `skipWaiting()`: una versión nueva espera a que el usuario acepte el toast "Actualizar" (`sw-register.tsx` le manda `postMessage('SKIP_WAITING')`) |
| `/_next/static/*` | Cache-first (contenido inmutable) |
| Navegaciones (`request.mode === 'navigate'`) | Network-first con caché de la última respuesta HTML; sin red y sin caché → `/offline.html` |
| `GET /api/v1/*` | Network-first; sin red, sirve la caché y añade `X-From-Cache: 1` (leído por `lib/api/client.ts` → `isStale()` → `useApiQuery().stale`) |
| Métodos distintos de `GET` | **Nunca** se interceptan ni se cachean: toda escritura va siempre a la red o falla explícitamente |
| `/api/v1/auth/*` y `/auth/*` | Nunca se cachean |
| Imágenes de R2/MinIO | Cache-first con expiración simple (6 h) |

**`activate` y `clients.claim()`:** el SW toma el control de las páginas abiertas en cuanto se activa. Esto dispara
`controllerchange` en el cliente **incluso en la primera instalación** (no solo en una actualización real). El
registro (`sw-register.tsx`) solo recarga la página cuando un controlador **ya existente** es reemplazado por uno
nuevo; si no, la primera visita a la app se recargaría sola sin motivo — un bug real que se detectó con `e2e/offline.e2e.ts`
y las suites de invitación (una página recién abierta se recargaba a mitad de una acción de Playwright).

**Privacidad en dispositivo compartido:** el logout llama a `clearOfflineCaches()` (borra las cachés `html-*`/`api-*`).
Además, el SW olvida esas mismas cachés si detecta que `/api/v1/me` responde con un `id` de usuario distinto al último
visto (variable en memoria del propio worker).

## Push (alertas de personal) **[Por verificar]**

`public/sw.js` maneja `push` (`showNotification` con `title` / `body` / `data.url`) y `notificationclick`
(`clients.openWindow`). La suscripción vive en `push_subscriptions` y se gestiona desde el menú de cuenta.
Detalle: [`03-modulos/notificaciones.md`](../03-modulos/notificaciones.md). En iOS hace falta la PWA en modo
standalone para recibir push.

## Límite conocido de las navegaciones del App Router **[Por verificar]**

Las navegaciones del cliente (`<Link>`, `router.push`) piden payloads RSC con cabeceras `Vary`, que el SW no distingue
del resto. Sin red, Next cae a una navegación completa de documento, que el SW sí sirve desde `HTML_CACHE`. Esto
significa que **solo se ven sin red las páginas ya visitadas con conexión** en esa pestaña — no toda la app queda
disponible offline por transitividad de los enlaces.

## Escrituras deshabilitadas sin red

`OfflineDisabledButton` envuelve el botón y muestra un tooltip explicando por qué está deshabilitado. Se usa en:

- "Añadir a cuenta" (`components/pos/cart-sheet.tsx`) — cobrar directo ya **no** usa este componente (F3, ver arriba)
- Añadir ítems a una cuenta abierta (`components/pos/add-to-tab-dialog.tsx`)
- Cobrar el saldo de una cuenta (`components/pos/tab-detail-sheet.tsx`)
- Ajustar inventario (`app/(dashboard)/inventory/page.tsx`)

El resto de formularios CRUD (productos, categorías, clientes, proveedores, ajustes, promociones) **no** están
pre-deshabilitados: si el usuario intenta guardar sin red, `lib/api/client.ts` convierte el `fetch` fallido en
`ApiError(0, 'network_offline')` y el formulario muestra el error traducido de la forma habitual. No hay pérdida de
datos silenciosa, solo un paso menos preventivo que en los tres puntos de arriba (dinero y stock).

## Pruebas

- Unitarias: `hooks/use-online-status` (evento `online`/`offline`), `lib/api/client.test.ts` (mapeo `network_offline`,
  `X-From-Cache` → `isStale`, `redirectOnUnauthorized`), `lib/offline/db.test.ts` (no-op sin `indexedDB`),
  `lib/offline/outbox.test.ts` (estados, FIFO, `client_ref` idempotente), `lib/offline/sync.test.ts` (envío, 401,
  4xx, red/5xx con backoff, usuario distinto, backoff no vencido).
- Componente: `components/connection-status.tsx` (badge + toasts); `use-pos-snapshot.test.tsx` (fetch al montar,
  `refresh()`, una petición fallida conserva lo ya cargado); `use-outbox-sync.test.tsx` (montaje, evento `online`,
  un fallo conserva el contador); `pos.test.tsx` (navegar y buscar sin red desde la instantánea; cobrar sin red
  encola en vez de llamar al servidor; el botón se bloquea si expiró la ventana offline).
- E2E (`e2e/offline.e2e.ts`, requiere el build de producción): una vista cacheada se sigue viendo sin red con el
  badge y el toast correspondientes; y un cobro sin red encola la venta (el stock no se mueve todavía), vuelve la
  red y la venta se sincroniza sola (el stock baja).
