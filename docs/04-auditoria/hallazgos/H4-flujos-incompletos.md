# H4 — Flujos incompletos o falsos

| | |
|---|---|
| **Severidad** | Alto (funcional) |
| **Área** | Funcionalidad / veracidad del producto |
| **Esfuerzo** | Medio |
| **Estado** | Abierto |
| **Confianza** | **[Verificado]** (búsquedas por `from('tabla')` y lectura de cada pantalla) |

## Hallazgos

| # | Funcionalidad | Realidad | Evidencia |
|---|---|---|---|
| 1 | Recuperar contraseña | El correo redirige a `/reset-password`, que **no existe** (404). No hay pantalla para fijar la nueva contraseña | `forgot-password/page.tsx:25-27`; `app/` sin esa ruta |
| 2 | Guardar ajustes | "Save Settings" solo lanza un toast; no persiste. `settings` (BD) y `useSettingsStore` no se usan | `settings/page.tsx:23-25`; [ajustes](../../03-modulos/ajustes.md) |
| 3 | Alta/ajuste de stock | **Ninguna pantalla crea o ajusta inventario**; crear un producto no crea su fila de `inventory` | [inventario](../../03-modulos/inventario.md), [productos](../../03-modulos/productos.md) |
| 4 | Órdenes de compra | Solo esquema; sin UI | [proveedores-y-compras](../../03-modulos/proveedores-y-compras.md) |
| 5 | Gastos (`expenses`) | Solo esquema; sin UI | idem |
| 6 | Variantes de producto | No se pueden crear ni vender desde la UI | [estado cliente](../../01-arquitectura/04-estado-cliente.md) |
| 7 | Puntos de fidelidad / total gastado | Nunca se actualizan; los reportes usan datos del seed o `floor(total_spent)` | [clientes](../../03-modulos/clientes.md), [reportes](../../03-modulos/reportes.md) |
| 8 | "Profit analysis", "Realtime", "Atajos de teclado" | No existen (README los marca "ready") | [readme-vs-realidad](../readme-vs-realidad.md) |
| 9 | Perfil de usuario | El ítem "Profile" del menú no tiene acción | `layout.tsx:129-132` |
| 10 | Edición de clientes/proveedores | No existe (solo alta) | [clientes](../../03-modulos/clientes.md) |
| 11 | Recibo | No hay plantilla; `window.print()` imprime la pantalla | [ordenes-y-reembolsos](../../03-modulos/ordenes-y-reembolsos.md) |

## Impacto

El producto aparenta más completo de lo que es; funciones que el negocio necesita a diario (reponer stock,
recuperar contraseña) no se pueden hacer desde la aplicación. Riesgo reputacional si se entrega como "completo".

## Recomendación

1. Implementar `/reset-password` (`supabase.auth.updateUser({ password })` tras el enlace del correo) — **prioridad inmediata**.
2. Persistir ajustes en la tabla `settings` y consumirlos (tasa, umbral, moneda, recibo).
3. Pantalla de inventario con: recepción, ajuste con motivo, edición de umbral y alta de inventario al crear producto.
4. Flujo de órdenes de compra con recepción que sume stock ([diagrama](../../03-modulos/proveedores-y-compras.md#flujo-previsto-no-construido)).
5. Mantener `total_spent`/`loyalty_points` derivados (trigger o vista).
6. **Corregir el README** para reflejar el estado real (ver [readme-vs-realidad](../readme-vs-realidad.md)).

## Criterios de aceptación

- [ ] Un usuario puede recuperar su contraseña de extremo a extremo.
- [ ] Cambiar un ajuste lo persiste y tiene efecto observable.
- [ ] Se puede registrar entrada de mercancía y ajustar stock con bitácora.
- [ ] El README no afirma capacidades inexistentes.
