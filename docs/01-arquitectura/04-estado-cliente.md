# Estado en el cliente

> Actualizado tras la etapa 1. Confianza: **[Verificado]** (`stores/cart.test.ts`, `test/components/pos.test.tsx`).

Casi no hay estado global: **los datos del servidor no se cachean en el cliente**; cada pantalla los pide a la API con `useApiQuery`.

| Qué | Dónde | Persistencia |
|---|---|---|
| Usuario y ajustes de la tienda | `SessionProvider` (contexto), rellenado por el layout servidor | Ninguna: se recalcula en cada navegación de servidor (`router.refresh()` tras guardar ajustes) |
| Carrito del POS | `stores/cart.ts` (Zustand + `persist`) | `localStorage['pos-cart']`, versión 2 |
| Datos de pantallas | `useApiQuery` (estado local del componente) | Ninguna |
| Tema claro/oscuro | `next-themes` | `localStorage` |

Se eliminaron `stores/auth.ts` y `stores/settings.ts` (el primero se hidrataba desde el cliente; el segundo no lo leía nadie).

## Carrito (`stores/cart.ts`)

Guarda **solo qué se compra**: `{ productId, quantity, discount }` por línea y un descuento global. **Nunca** precios, tasas de impuesto, totales ni el objeto `Product`
(la versión 1 persistía el producto entero y mostraba precios obsoletos; al subir a la versión 2 se descarta esa forma). Acciones: `addItem` (fusiona repetidos), `removeItem`,
`updateQuantity` (≤ 0 elimina la línea), `updateItemDiscount`, `setGlobalDiscount`, `clearCart`. Cantidad máxima 100 000; descuentos nunca negativos.

El POS **valora el carrito con datos en vivo**: pide `GET /products?ids=…` con los ids de las líneas (precio, tasa y stock actuales) y calcula una **vista previa**
(`lib/cart-preview.ts`, aritmética en centavos y puntos básicos, redondeo por línea "mitad hacia arriba", descuento global después del impuesto: **igual que `create_sale`**;
verificado contra el resultado de la BD). El total que cuenta es el que devuelve `POST /sales`.

Se **vacía** al cerrar sesión (`AppShell`) y tras una venta correcta; tras un error se conserva.

Los bloqueos de la UI (no una garantía; el servidor decide): botón "+" deshabilitado al llegar al stock, checkout deshabilitado si una línea supera el stock, el producto está
inactivo, no tiene fila de inventario o ya no existe.

## `useApiQuery(fetcher, key)`

- Vuelve a pedir cuando cambia `key` (poner **todas** las entradas de la petición: `JSON.stringify({ page, search })`).
- Cancela la petición anterior y **ignora respuestas obsoletas**.
- Conserva el último dato mientras carga (las listas no parpadean); `loading` es "la petición de la clave actual no ha terminado".
- No llama a `setState` de forma síncrona en un efecto (regla `react-hooks/set-state-in-effect`): el resultado se guarda junto a la clave que lo produjo.
- `reload()` fuerza otra petición (tras crear, editar, borrar).

Otros hooks: `useDebouncedValue` (300 ms para buscadores) y `useHydrated` (falso hasta que React hidrata; evita envíos de formulario prematuros).

## Contexto de sesión

`useSession()` devuelve `{ user, settings }`; `useMoney()` da un formateador con la moneda de los ajustes (`Intl.NumberFormat`). Lanzan un error claro si se usan fuera del
`SessionProvider`. La navegación se filtra con `roleAtLeast(user.role, minimumRole)`.

## Reglas
- No copiar datos del servidor a un store: pedirlos con `useApiQuery`.
- Lo que se persiste en el navegador no debe contener datos que el servidor tenga que decidir (precios, permisos, totales).
- Todo estado ligado a la sesión debe vaciarse en el logout.
