# PWA y modo offline (lectura)

> Nuevo en la etapa 2 · Confianza: **[Verificado]** (`test/components/use-online-status.test.tsx`, `test/components/connection-status.test.tsx`, `lib/api/client.test.ts`, `e2e/offline.e2e.ts`).

La app es instalable (escritorio y Android/iOS) y sigue mostrando las **vistas ya visitadas** sin red, con avisos claros
de conexión. **No hay cola de escrituras sin red**: eso queda documentado como plan en
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
| `components/connection-status.tsx` | Badge siempre visible + toast persistente al perder la red + toast de éxito al volver, en el header del layout ([sidebar](../03-modulos/) via `app-shell.tsx`) |
| `hooks/use-online-status.ts` | `useSyncExternalStore` sobre `navigator.onLine` y los eventos `online`/`offline` |
| `components/pwa/offline-disabled-button.tsx` | Botón que se deshabilita solo (con tooltip) mientras no hay red: usado en cobrar, añadir/pagar cuenta y ajustar inventario |
| `lib/pwa/clear-cache.ts` | Borra las cachés de HTML/API al cerrar sesión (dispositivo compartido) |

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

## Límite conocido de las navegaciones del App Router **[Por verificar]**

Las navegaciones del cliente (`<Link>`, `router.push`) piden payloads RSC con cabeceras `Vary`, que el SW no distingue
del resto. Sin red, Next cae a una navegación completa de documento, que el SW sí sirve desde `HTML_CACHE`. Esto
significa que **solo se ven sin red las páginas ya visitadas con conexión** en esa pestaña — no toda la app queda
disponible offline por transitividad de los enlaces.

## Escrituras deshabilitadas sin red

`OfflineDisabledButton` envuelve el botón y muestra un tooltip explicando por qué está deshabilitado. Se usa en:

- Cobrar y "Añadir a cuenta" (`components/pos/cart-sheet.tsx`)
- Añadir ítems a una cuenta abierta (`components/pos/add-to-tab-dialog.tsx`)
- Cobrar el saldo de una cuenta (`components/pos/tab-detail-sheet.tsx`)
- Ajustar inventario (`app/(dashboard)/inventory/page.tsx`)

El resto de formularios CRUD (productos, categorías, clientes, proveedores, ajustes, promociones) **no** están
pre-deshabilitados: si el usuario intenta guardar sin red, `lib/api/client.ts` convierte el `fetch` fallido en
`ApiError(0, 'network_offline')` y el formulario muestra el error traducido de la forma habitual. No hay pérdida de
datos silenciosa, solo un paso menos preventivo que en los cuatro puntos de arriba (dinero y stock).

## Pruebas

- Unitarias: `hooks/use-online-status` (evento `online`/`offline`), `lib/api/client.test.ts` (mapeo `network_offline`
  y `X-From-Cache` → `isStale`).
- Componente: `components/connection-status.tsx` (badge + toasts).
- E2E (`e2e/offline.e2e.ts`, requiere el build de producción): visita `/products` y `/pos` con red, agrega un producto
  al carrito, fuerza `context.setOffline(true)`, comprueba que la vista se sigue viendo, el badge y el toast avisan, y
  el botón de cobrar está deshabilitado; luego `setOffline(false)` y comprueba el toast de reconexión.
