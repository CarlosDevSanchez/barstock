# Módulo: Clientes

> Archivos: `app/(dashboard)/customers/page.tsx` (186), `app/(dashboard)/customers/[id]/page.tsx` (208) · Base: commit `54962b9`

## Listado — `/customers`

- `customers` (`created_at desc`), sin paginar. Buscador en memoria por nombre, email y teléfono.
- Tarjeta con el total de clientes. Tabla: nombre, email, teléfono, puntos, total gastado, estado.
- Cada fila navega a `/customers/[id]`.
- **Solo alta y lectura**: no hay editar ni borrar ni activar/desactivar (el import `Edit` no se usa).
- Alta (`Dialog`): `name` (obligatorio), `email`, `phone`, `address`. Estado inicial de todos = `''`.

## Detalle — `/customers/[id]`

- `customers` por id (`.single()`) y `orders` del cliente (`created_at desc`).
- Tarjetas: Total Spent (`customer.total_spent`, valor **guardado**, no calculado), órdenes completadas
  ("N of M total", con `M = orders.length`, `:71-72,104-105`), Loyalty Points (`customer.loyalty_points`) y
  estado. Tabla de órdenes con enlace al detalle de cada una.
- Inconsistencia: el "Total Spent" guardado puede no coincidir con la suma real de las órdenes completadas
  del mismo cliente que la propia pantalla lista debajo.

## Defectos y riesgos

| # | Detalle | Efecto |
|---|---|---|
| 1 | `email: ''` se inserta como cadena vacía en una columna `UNIQUE` **[Inferido]** | El **segundo** cliente sin email choca con `customers_email_key`. Convertir `''` → `null` |
| 2 | Nada actualiza `total_spent` ni `loyalty_points` al vender/reembolsar | Los valores mostrados son los del seed o manuales; "Top customers" en reportes es engañoso ([reportes](reportes.md)) |
| 3 | Sin edición, borrado ni desactivación | Datos erróneos no se pueden corregir desde la UI |
| 4 | Sin validación de teléfono/email más allá de `type="email"` | |
| 5 | **Datos personales visibles y modificables por cualquier usuario autenticado** (RLS `ALL`) | Riesgo de privacidad/cumplimiento ([C1](../04-auditoria/hallazgos/C1-rls-permisivo.md)) |
| 6 | En el POS el selector muestra `nombre - teléfono` (queda un guion colgante si no hay teléfono) | Cosmético |
| 7 | Sin paginación ni búsqueda en servidor | No escala con miles de clientes |
| 8 | Sin política de retención/eliminación de datos personales | Definir según normativa aplicable |

## Reglas de negocio pendientes de definir

Ver [decisiones-pendientes](../06-roadmap/decisiones-pendientes.md): ¿cómo se acumulan y canjean los puntos?
(el reporte los deriva como `floor(total_spent)`, sin base en el código de ventas), ¿los reembolsos restan
puntos y gasto?

## Recomendación técnica

Mantener `total_spent`/`loyalty_points` **derivados**: mediante trigger sobre `orders` o vista
(`select customer_id, sum(total) … where status='completed'`), no como columnas editables por el cliente.
