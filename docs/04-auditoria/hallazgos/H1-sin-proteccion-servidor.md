# H1 — Sin protección de rutas en el servidor; sesión solo en el navegador

| | |
|---|---|
| **Severidad** | Alto |
| **Área** | Seguridad — autenticación |
| **Esfuerzo** | Medio |
| **Estado** | Abierto |
| **Confianza** | **[Verificado]** en código |

## Hallazgo

- No existe `middleware.ts` ni `proxy.ts` (verificado). La única guarda es un `useEffect` en
  `app/(dashboard)/layout.tsx:44-67` que llama `supabase.auth.getSession()` y redirige con `router.push('/login')`.
- El cliente es `createClient` de `@supabase/supabase-js` puro: la sesión (JWT y refresh token) vive en
  `localStorage`, accesible a cualquier script de la página (XSS). No hay cookies `httpOnly`.
- Si la carga del perfil falla, la app se muestra igualmente con `user = null` (`layout.tsx:59-63`).
- No hay `onAuthStateChange`: la expiración de sesión no redirige.
- El README afirma "Protected routes with middleware": **falso**.

## Impacto

- El HTML/JS de las pantallas administrativas se sirve a cualquiera; lo único que protege los datos es RLS ([C1](C1-rls-permisivo.md)).
- Robo de sesión más sencillo ante cualquier XSS futuro (token en `localStorage`).
- Sin base para autorización por rol en servidor ni para Server Components con datos protegidos.

## Recomendación

1. Adoptar **`@supabase/ssr`** con cliente de navegador y de servidor basados en cookies.
2. Añadir **`proxy.ts`** (Next 16; antes `middleware.ts`) que refresque la sesión y redirija a `/login` cuando no haya usuario en rutas de `(dashboard)`.
3. Guard por rol: leer el rol en el servidor (perfil) y devolver 403/redirect en rutas restringidas (`/settings`, `/reports`, `/suppliers`, `/products`).
4. Suscribirse a `onAuthStateChange` para reaccionar a expiración y cierre de sesión en otra pestaña.
5. Limpiar `useCartStore` en el logout.
6. Redirigir fuera de `/login` y `/register` si ya hay sesión.
7. Tras el cambio, revisar los avisos de *Middleware/Proxy bypass* de Next ([C3](C3-dependencias-vulnerables.md)) y mantener la versión actualizada.

## Criterios de aceptación

- [ ] Petición sin cookie de sesión a `/pos` recibe redirección desde el servidor (no desde el cliente).
- [ ] Un `cashier` que abre `/settings` es redirigido/recibe 403.
- [ ] La sesión no se almacena en `localStorage`.
- [ ] Al expirar la sesión, la UI redirige a `/login`.
- [ ] El logout vacía el carrito y el store de auth.

## Dependencias

Complementa [C1](C1-rls-permisivo.md); no lo sustituye (RLS sigue siendo la barrera principal).
