# C1 — RLS permite todo a cualquier usuario autenticado

| | |
|---|---|
| **Severidad** | Crítico |
| **Área** | Seguridad — autenticación y autorización |
| **Esfuerzo** | Medio |
| **Estado** | Corregido (RLS por rol, alta por invitación, rol protegido por trigger, verificados en BD y API). Pendiente de **Verificado**: pruebas automáticas de RLS (Paso 6) |
| **Confianza** | Análisis del SQL **[Verificado]**; estado real de la base y configuración de Auth **[Por verificar]** |

## Impacto

Un visitante puede crear una cuenta gratis y, con ella, leer datos personales de todos los clientes,
modificar precios y stock, editar o borrar ventas y pagos, cambiar ajustes y otorgarse el rol `admin`.
Además, todos los controles por rol de la interfaz son cosméticos.

## Hallazgo (evidencia)

1. **Políticas permisivas globales.** `supabase/fix_rls_policies.sql:37-82` crea `FOR ALL USING (auth.role() = 'authenticated')`
   para `product_variants`, `inventory`, `inventory_transactions`, `suppliers`, `purchase_orders`, `purchase_order_items`,
   `customers`, `orders`, `order_items`, `payments`, `expenses`, `settings`, y `SELECT/INSERT/UPDATE/DELETE` para `products` y `categories`.
2. **Las restricciones por rol quedan anuladas.** El parche solo borra 2 políticas; las de `schema.sql`
   (`Admins and Managers can manage products`, `Admins and Managers can update orders`, `Only admins can manage settings`)
   siguen existiendo pero, al ser permisivas y combinarse con OR, no restringen nada. Detalle en [RLS](../../02-base-de-datos/03-rls-y-politicas.md).
3. **Escalada de rol.** `schema.sql:276-277`: `Users can update own profile … FOR UPDATE USING (auth.uid() = id)` sin `WITH CHECK`
   ni lista de columnas → el usuario puede actualizar `profiles.role` de su propia fila.
4. **Registro abierto.** `app/(auth)/register/page.tsx` permite a cualquiera darse de alta; además ofrece un
   selector de rol (`admin/manager/cashier`) que el trigger `handle_new_user` ignora (`schema.sql:383`), pero que induce a error.
5. **Helpers de rol sin uso.** `stores/auth.ts` define `isAdmin`, `isManager`, `canManageProducts`; ningún archivo los llama.
6. **Anonymous sign-ins [Por verificar].** `auth.role() = 'authenticated'` también es verdadero para usuarios anónimos de Supabase si esa opción está activa.

## Cómo reproducir / verificar

En la consola del navegador con una sesión de cajero (con `supabase` accesible desde el bundle o un cliente equivalente):

```js
// 1) Escalada de privilegios
await supabase.from('profiles').update({ role: 'admin' }).eq('id', '<mi-uuid>')
// 2) Alterar ajustes / borrar datos financieros
await supabase.from('settings').update({ value: '"x"' }).eq('key', 'tax_rate')
await supabase.from('payments').delete().neq('id', '00000000-0000-0000-0000-000000000000')
```

Y en el SQL Editor, para auditar el estado real: consultas de [`03-rls-y-politicas.md`](../../02-base-de-datos/03-rls-y-politicas.md#cómo-auditar-el-estado-real-ejecutar-en-el-sql-editor-de-supabase).
No ejecutar los `delete` en producción.

## Recomendación

1. **Reescribir RLS por rol** con una función auxiliar `SECURITY DEFINER STABLE` (`public.current_role()`) que lea `profiles.role`
   con `SET search_path = ''`. Aplicar la matriz objetivo de [RLS](../../02-base-de-datos/03-rls-y-politicas.md#matriz-objetivo-propuesta-no-aplicada).
2. **Proteger `profiles.role`:** trigger `BEFORE UPDATE` que rechace cambios de `role` salvo que quien actúa sea admin, o política con `WITH CHECK`.
3. **Cerrar el registro público:** desactivar *Enable sign ups* en Supabase y crear usuarios por invitación desde un admin; o dejar
   el alta y forzar `cashier` + aprobación. Quitar el selector de rol de `/register`.
4. **Escrituras sensibles solo por RPC** (`create_sale`, `refund_order`, `adjust_inventory`) y **revocar** `INSERT/UPDATE/DELETE` directos
   sobre `orders`, `order_items`, `payments`, `inventory`, `inventory_transactions` para el rol `authenticated`.
5. Desactivar *Anonymous sign-ins* si no se usan.
6. Usar los helpers de rol en la UI para ocultar navegación/acciones (defensa en profundidad, **no** como control de seguridad).
7. Pruebas SQL de políticas (pgTAP o `set local role` + `request.jwt.claims`) para cada rol.

Borrador: [`diseno-objetivo-seguridad.md`](../../06-roadmap/diseno-objetivo-seguridad.md).

## Criterios de aceptación

- [ ] Un `cashier` no puede: cambiar su `role`, borrar/editar `products`, leer/escribir `settings`, insertar en `orders`/`payments` directamente, ni borrar ventas.
- [ ] Un `manager` no puede modificar `settings` ni roles.
- [ ] Solo un `admin` puede cambiar roles.
- [ ] El registro público está cerrado (o requiere aprobación) y no hay selector de rol.
- [ ] Existen tests automatizados de políticas por rol ejecutados en CI.
- [ ] `fix_rls_policies.sql` queda archivado como histórico y **no** forma parte del setup.

## Dependencias

Debe hacerse **antes o junto con** [C2](C2-checkout-no-atomico.md) (las RPC necesitan que el modelo de permisos esté definido) y [H1](H1-sin-proteccion-servidor.md).
