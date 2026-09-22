# Autenticación, sesión y roles

> Actualizado tras la etapa 1. Confianza: **[Verificado]** (`test/integration/auth.test.ts`, `proxy.test.ts`, `rls.test.ts`, `e2e/roles.e2e.ts`, `e2e/invitation.e2e.ts`).

## Resumen

- Supabase Auth (email + contraseña) como proveedor de identidad; **la sesión vive en cookies** gestionadas por `@supabase/ssr` en el servidor.
  El navegador nunca recibe ni guarda tokens (ni en `localStorage`): `POST /auth/login` devuelve solo `{ id, email, fullName, role }`.
- El **rol** vive en `profiles.role` (`admin ≥ manager ≥ cashier`) y se lee de la base de datos **en cada petición**: un cambio de rol o una
  desactivación tiene efecto inmediato, sin esperar a que caduque el JWT.
- **Alta solo por invitación** de un admin. No existe `/register` y el registro público está desactivado.

## Piezas

| Pieza | Función |
|---|---|
| `proxy.ts` | Refresca la sesión, redirige o responde `401` sin sesión, guarda por rol las secciones (`/settings`, `/users` admin; `/reports`, `/suppliers` gerente). **Guarda de UX**, no la frontera de seguridad |
| `lib/server/auth.ts` | `loadSession()` → `auth.getUser()` (valida el JWT contra Auth) + lectura de `profiles`; `requireUser()`, `requireRole(min)` |
| `route()` (`lib/server/http.ts`) | Comprueba origen → sesión y rol → validación; devuelve 401/403 |
| Layout del dashboard (Server Component) | `getSession()`; sin sesión, `redirect('/login')`; pasa usuario y ajustes a `AppShell` |
| RLS + trigger de `profiles` | Frontera real: aunque la API tuviera un fallo, la base de datos rechaza la operación |

## Flujos

### Login
`/login` (react-hook-form + `loginSchema`) → `POST /api/v1/auth/login` → `signInWithPassword` con el cliente ligado al request → cookies → `/dashboard`
(o la ruta de `?next=`, **solo si empieza por `/` y no por `//`**: nunca a una URL externa).

- Email desconocido y contraseña errónea dan **exactamente el mismo** `401` (no se puede averiguar qué emails existen).
- Credenciales válidas pero cuenta desactivada: `403 "This account is disabled"` y no se crea sesión.
- El límite de intentos es el de Supabase Auth (`429` → `too_many_requests`); no hay uno propio.
- El botón de envío está deshabilitado hasta que React hidrata y el `<form>` usa `method="post"`: un envío previo haría un `GET` nativo y **dejaría la
  contraseña en la URL** (ocurrió al probar).

### Invitación (alta de usuario)
1. Admin → `/users` → "Invite user" → `POST /api/v1/users/invite { email, full_name?, role }`.
2. El servidor usa el cliente `service_role` **solo aquí**: `auth.admin.inviteUserByEmail` y después `updateUserById(app_metadata: { role })`. Si asignar el rol falla,
   **se borra el usuario** (no queda uno sin el rol previsto).
3. Un trigger de la BD copia el rol de `app_metadata` al perfil y lo **activa**. Un perfil nace activo **solo si el servidor le asignó rol**: quien se dé de alta
   por otra vía (p. ej. un signup abierto en un proyecto hospedado) obtiene un `cashier` **inactivo**, sin acceso a nada. El rol se lee **solo de `app_metadata`**;
   `user_metadata` lo puede editar el usuario y no se usa.
4. Correo (plantilla propia en `supabase/templates/invite.html`) → enlace `/auth/confirm?token_hash=…&type=invite`.
5. `app/auth/confirm/route.ts` canjea el token **en el servidor** (`verifyOtp`), crea la cookie de sesión y redirige a `/reset-password`. Ningún token pasa por el
   navegador ni por un fragmento de URL. El enlace es **de un solo uso**.
6. `/reset-password` (`POST /auth/password/reset`) fija la contraseña; luego `/dashboard`.

### Recuperar contraseña
`/forgot-password` → `POST /auth/password/forgot` (**siempre 204**, exista o no el email) → correo → `/auth/confirm?type=recovery` → `/reset-password`.
Un escáner de correo que abra el enlace antes lo consume: el usuario pide otro.

### Contraseñas
Entre 10 y 72 caracteres (72 = límite de bcrypt), validado en el esquema (`resetPasswordSchema`) y en `minimum_password_length = 10` de Supabase.

### Logout
`POST /auth/logout` → `signOut` (revoca la sesión en el servidor) y `AppShell` **vacía el carrito**: no se deja a la siguiente persona de la caja.

### Desactivar o cambiar el rol
Admin → `/users` → `PATCH /users/{id}`. Efecto en la **siguiente petición** del usuario (`401`). No puede desactivarse a sí mismo ni quitarse el rol de admin,
y un trigger protege al **último admin activo**. Al abrir `/login` con una sesión válida pero un perfil inactivo, `proxy.ts` **cierra la sesión** (antes había un bucle de
redirecciones infinito `layout → /login → proxy → /dashboard`).

## Idioma de la interfaz
Cada usuario tiene `profiles.locale` (`es` \| `en`, defecto `es`). El layout escribe la cookie `NEXT_LOCALE`; `next-intl` carga `messages/{locale}.json` sin segmento `[locale]` en la URL.
Cambiar idioma: Ajustes o selector del shell → `PATCH /api/v1/me { locale }` (cajero+) → actualiza el perfil y la cookie → `router.refresh()`.

## Cookies de sesión
`@supabase/ssr` las crea con `httpOnly: false` (su cliente de navegador las necesita). Como el navegador aquí no usa `supabase-js`, `lib/auth/cookie-options.ts` las
fuerza a **`HttpOnly`** (un XSS no puede leerlas), **`Secure`** cuando `APP_URL` es https (no según `NODE_ENV`: una compilación de producción servida por http, como el Docker local, debe seguir teniendo cookies; Safari descarta las `Secure` sobre http) y conserva `SameSite=Lax` y `Path=/`. Verificado en Chromium: `document.cookie` no ve la sesión.

## Defensa contra CSRF
Las escrituras (`POST/PATCH/DELETE`) con `Origin` distinto del host servido (o `x-forwarded-host` detrás de un proxy) se rechazan con `403`; sin `Origin`
(clientes que no son navegadores, sin cookies ambientales) se permiten. Se suma `SameSite=Lax` y que los cuerpos son JSON.

## Roles: quién puede qué
Tabla completa de RLS en [rls-y-politicas](../02-base-de-datos/03-rls-y-politicas.md); tabla de endpoints en [API](08-api.md). Resumen:

| Rol | Puede |
|---|---|
| **cashier** | Vender, ver catálogo, stock, clientes y **sus** órdenes, ver ajustes |
| **manager** | Todo lo anterior + escribir catálogo/proveedores, ajustar stock, reembolsar, ver todas las órdenes y reportes |
| **admin** | Todo + ajustes, usuarios (invitar, rol, desactivar), borrado físico |

## Configuración relevante (`supabase/config.toml`)
`enable_signup = false`; el proveedor de email **debe seguir activo** (`[auth.email] enable_signup = false` desactiva también el login); `enable_confirmations = true`;
`minimum_password_length = 10`; `site_url = http://localhost:3000`; `jwt_expiry = 3600`; plantillas de invitación y recuperación. En un proyecto hospedado
hay que replicar estos ajustes y pegar las plantillas en *Authentication → Email Templates*.

## Pendiente
- MFA, política de complejidad de contraseñas más allá de la longitud, y rotación de claves (D19).
- El límite de intentos de login es solo el de Auth.
