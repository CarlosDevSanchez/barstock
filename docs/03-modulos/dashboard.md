# Módulo: Dashboard

> Actualizado tras la etapa 1 · `app/(dashboard)/dashboard/page.tsx` · API `GET /dashboard` · RPC `dashboard_summary` · Confianza: **[Verificado]** (`admin.test.ts`, `rpc.test.ts`).

Antes: ~12 consultas desde el navegador, sin ordenar ni excluir reembolsos, con "Low Stock" topado en 5 y un umbral fijo de 10. Ahora **una petición** y agregación en SQL.

## Qué muestra
| Bloque | Definición |
|---|---|
| Ingresos de hoy / órdenes de hoy | Órdenes `completed` del día **en la zona horaria de Ajustes** |
| Ingresos del mes | Desde el día 1 del mes en esa zona |
| Clientes | Total de clientes |
| Stock bajo (contador) | **Recuento exacto** de artículos con `quantity <= low_stock_threshold` (umbral **por fila**), activos y no borrados |
| Ventas de 7 días | Serie diaria con días sin ventas rellenados con 0 |
| Top productos | 5 más vendidos por unidades en los **últimos 30 días** |
| Alertas de stock | Hasta 5 artículos, ordenados por cantidad; "and N more" si hay más |

## Alcance por rol (RLS)
La función es **`SECURITY INVOKER`**: corre con el RLS del que llama. El dashboard de un **cajero** solo suma **sus** ventas; el de un **gerente/admin**, las de todos (verificado). El stock y los clientes son comunes.

## Reglas
- **Se excluyen los reembolsos** (solo `completed`).
- Días agrupados por la zona `settings.timezone` (por defecto `UTC`); el gráfico formatea fechas de calendario sin desplazarlas por la zona del navegador.
- La respuesta se **valida con zod** en el servidor: si el SQL y la UI divergen falla ahí, no muestra `NaN`.

## Límites conocidos
- Sin comparativas (vs. ayer/mes anterior), sin filtros de fecha (para eso, [Reportes](reportes.md)) y sin refresco automático.
- "Top productos" es por unidades; no hay por ingresos.

Relacionados: [Reportes](reportes.md), [Ajustes](ajustes.md), [triggers y funciones](../02-base-de-datos/04-triggers-y-funciones.md).
