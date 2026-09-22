# Módulo: Usuarios

> Nuevo en la etapa 1 · `app/(dashboard)/users/page.tsx` · API `users`, `users/invite`, `users/[id]` · Servicio `services/users.ts` · Confianza: **[Verificado]** (`auth.test.ts`, `admin.test.ts`, `rls.test.ts`, e2e `invitation`).

- **Quién:** solo **admin** (`proxy.ts` redirige, la API responde `403`).
- **Lista:** paginada, con búsqueda por nombre o email; muestra rol, estado (Active/Disabled) y fecha de alta.

## Acciones
| Acción | Cómo | Notas |
|---|---|---|
| **Invitar** | Diálogo: email*, nombre, rol* → `POST /users/invite` | Envía el correo de invitación; el perfil nace **activo con ese rol**. Email existente → 409 |
| **Cambiar rol** | Selector en la fila → `PATCH /users/{id} { role }` | Efecto **inmediato**, sin volver a iniciar sesión |
| **Desactivar / activar** | Botón + `ConfirmDialog` → `PATCH { is_active }` | El usuario pierde el acceso en su siguiente petición (401) y no puede iniciar sesión (403) |

## Protecciones
- **No puedes cambiar tu propio rol ni desactivarte** (422); tu fila no tiene controles.
- Un trigger de la BD impide degradar o desactivar al **último admin activo**, aunque se intente por otra vía.
- Un cajero o gerente **no puede** cambiar roles (ni el suyo) por ninguna vía: la API responde 403 y la BD lo rechaza (`rls.test.ts`).
- El rol se asigna en `app_metadata` (solo el servidor puede escribirlo); un rol en `user_metadata` se ignora.

Flujo completo del correo, enlace de un solo uso y contraseña en [autenticación](../01-arquitectura/03-autenticacion-y-sesion.md).

## Límites conocidos
- **Reenviar una invitación:** invitar de nuevo el mismo email mientras el usuario **no la haya aceptado** funciona (Supabase Auth reenvía el correo; comprobado contra la Auth local llamando
  al endpoint directamente, no a través de la UI). Si ya aceptó, la API responde 409.
- Sin edición de nombre o email desde la UI y sin borrado (se desactiva).
- Sin historial de accesos ni auditoría de cambios de rol.
- Sin MFA (D19).
