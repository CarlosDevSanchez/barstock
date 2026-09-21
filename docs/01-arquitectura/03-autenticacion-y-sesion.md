# Autenticación, sesión y roles

> ⚠️ **Describe el estado ANTERIOR a la etapa 1 (commit `54962b9`).** Desde entonces el navegador solo habla con `/api/v1`, RLS es por rol y la
> lógica de negocio vive en RPC de la BD: ver [API](08-api.md) y [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md). Este documento se reescribe en el Paso 8.

> Base: commit `54962b9` · Confianza: **[Verificado]** en código; comportamiento de Supabase Auth **[Por verificar]** (configuración del proyecto).

## Resumen

Autenticación con **Supabase Auth (email + contraseña)** ejecutada 100 % desde el navegador. La sesión
la gestiona `supabase-js` (almacenamiento en `localStorage`, **no** cookies `httpOnly`). No hay
verificación de sesión en el servidor. Los roles existen en datos pero **no gobiernan ningún acceso**.

## Componentes

| Pieza | Archivo | Qué hace |
|---|---|---|
| Cliente Supabase | `lib/supabase/client.ts` | `createClient(URL!, ANON_KEY!)`, singleton de módulo. Sin validación de env. |
| Login | `app/(auth)/login/page.tsx` | `signInWithPassword`; éxito → `router.push('/dashboard')`; error → toast con `error.message` |
| Registro | `app/(auth)/register/page.tsx` | `signUp` con `options.data = { full_name, role }`; éxito → toast + `/login` |
| Recuperar contraseña | `app/(auth)/forgot-password/page.tsx` | `resetPasswordForEmail` con `redirectTo = <origin>/reset-password` |
| Guarda + carga de perfil | `app/(dashboard)/layout.tsx:44-67` | `getSession()` → si no hay sesión `router.push('/login')`; si hay, `select * from profiles where id = session.user.id` → `setUser` |
| Logout | `app/(dashboard)/layout.tsx:69-73` | `signOut()`, `setUser(null)`, `/login` |
| Store | `stores/auth.ts` | `user: Profile \| null` y helpers de rol |
| Alta de perfil | `supabase/schema.sql:380-392` | Trigger `on_auth_user_created` → `handle_new_user()` |

## Flujo de sesión

```mermaid
sequenceDiagram
    participant U as Usuario
    participant L as /login
    participant S as Supabase Auth
    participant D as layout (dashboard)
    participant P as profiles (RLS)
    U->>L: email + contraseña
    L->>S: signInWithPassword
    S-->>L: sesión (JWT en localStorage)
    L->>D: router.push('/dashboard')
    D->>S: getSession()
    alt sin sesión
        D->>U: router.push('/login')
    else con sesión
        D->>P: select * where id = uid
        P-->>D: perfil (o null)
        D->>D: setUser(perfil); setLoading(false)
    end
```

## Roles

`user_role` = `admin | manager | cashier` (`schema.sql:8`, `types/index.ts:2`). Default `cashier`.

| Aspecto | Realidad |
|---|---|
| Asignación en el registro | El formulario ofrece "Admin / Manager / Cashier" y lo envía en `user_metadata.role`, **pero** `handle_new_user` inserta solo `id, email, full_name` (`schema.sql:383`). El rol siempre queda `cashier`. El selector es **engañoso**, no explotable por sí solo. |
| Cambio de rol | La política `"Users can update own profile"` (`schema.sql:276-277`) permite `UPDATE` de la **fila propia sin restringir columnas**: un usuario puede ejecutar `update({role:'admin'})` sobre sí mismo desde la consola del navegador. **[Por verificar]** contra la base real; el análisis del SQL lo respalda. |
| Uso en UI | Solo se muestra `user.role` en el sidebar (`layout.tsx:122`). `isAdmin()`, `isManager()` y `canManageProducts()` no se invocan en ningún archivo. |
| Uso en RLS | Las políticas por rol de `schema.sql` (productos, actualizar órdenes, ajustes) quedan **anuladas** por las políticas permisivas de `fix_rls_policies.sql`. Ver [RLS](../02-base-de-datos/03-rls-y-politicas.md). |
| Navegación | Los 10 ítems del menú se muestran a todos (`layout.tsx:20-31`). |

## Comportamientos a tener en cuenta

- **Guarda solo en cliente.** El HTML/JS de `/pos`, `/settings`, etc. se sirve a cualquiera; lo protegido
  es el **dato** (por RLS, hoy permisivo). Con `loading=true` el layout no renderiza `children`, por lo que
  las páginas no consultan datos hasta confirmar sesión.
- **Perfil ausente no bloquea.** Si el `select` de `profiles` falla o devuelve vacío, `user` queda `null`
  pero igual se ejecuta `setLoading(false)` y se muestra la app (`layout.tsx:59-63`). El POS entonces
  inserta `created_by: undefined`.
- **Sin manejo de expiración.** No hay `onAuthStateChange`; si el JWT expira con la pestaña abierta,
  las queries devolverán vacío/error sin redirigir.
- **Login no redirige si ya hay sesión.** Un usuario autenticado puede visitar `/login` y `/register`.
- **Carrito y sesión.** `handleLogout` no llama a `clearCart()`; el carrito persistido en `localStorage`
  sobrevive entre usuarios (ver [estado cliente](04-estado-cliente.md)).
- **Política de contraseña.** Mínimo 6 caracteres comprobado en cliente (`register/page.tsx:32`);
  el servidor aplica lo que configure Supabase. Sin protección de fuerza bruta propia.
- **Recuperación rota.** `/reset-password` no existe: el enlace del email termina en 404 y no hay
  pantalla para fijar la nueva contraseña ([H4](../04-auditoria/hallazgos/H4-flujos-incompletos.md)).
- **Confirmación de email.** El toast dice "check your email to verify", pero si se exige o no depende del
  proyecto Supabase (**[Por verificar]**). Es determinante para la gravedad de [C1](../04-auditoria/hallazgos/C1-rls-permisivo.md).

## Diseño objetivo

Ver [`06-roadmap/diseno-objetivo-seguridad.md`](../06-roadmap/diseno-objetivo-seguridad.md):
`@supabase/ssr` con cookies, `proxy.ts` que redirija sin sesión, guard por rol, registro cerrado o por
invitación, y bloqueo de la columna `role`.
