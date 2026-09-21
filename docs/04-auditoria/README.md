# Auditoría técnica — barstock

> **Fecha:** 2026-09-21 · **Commit auditado:** `54962b9` (rama `main`, 2 commits) · **Metodología:** ver abajo
> Este archivo es el resumen ejecutivo. Cada hallazgo tiene su archivo en [`hallazgos/`](hallazgos/).

## Resumen ejecutivo

**Estado general.** Prototipo funcional y ordenado visualmente, con buen tipado (`tsc` limpio en modo
`strict`) y sin secretos en el repositorio. **No es apto para manejar dinero real** en su estado actual:
la seguridad de datos y la integridad del cobro tienen fallos de fondo, y buena parte de lo que el README
declara como "listo" no existe. El commit `fbf0f65` afirma "Zero bugs" y "RLS fixed"; esta auditoría lo
contradice en los puntos siguientes.

### Tres hallazgos críticos

1. **[C1](hallazgos/C1-rls-permisivo.md) — No hay autorización.** Cualquier usuario autenticado puede leer, modificar y borrar todo, incluido su propio rol; el registro es abierto.
2. **[C2](hallazgos/C2-checkout-no-atomico.md) — El cobro no es atómico ni confiable.** Totales calculados en el cliente, cinco o más llamadas sin transacción, y el descuento de stock probablemente falla en silencio.
3. **[C3](hallazgos/C3-dependencias-vulnerables.md) — `next@16.1.6` con 30+ advisories** (2 críticos). Corregible actualizando a `16.3.5`.

### Acción inmediata recomendada

Cerrar el RLS por rol → mover el cobro/reembolso a funciones SQL transaccionales → actualizar Next.
Las dos primeras dependen una de otra; ver [plan de remediación](../06-roadmap/plan-de-remediacion.md).

## Metodología y alcance

| Actividad | Resultado |
|---|---|
| Lectura completa del código de `app/`, `stores/`, `lib/`, `types/`, `supabase/*.sql`, configuración | Hecha |
| `npm audit` (contra `package-lock.json`) | 15 paquetes vulnerables: 1 crítico, 10 high, 3 moderate, 1 low |
| `npm outdated` | Ejecutado tras `npm ci`: 29 paquetes con versión más reciente disponible ([detalle](dependencias-npm-audit.md#paquetes-desactualizados)) |
| `tsc --noEmit` | **Sin errores** |
| `eslint .` | **32 errores, 10 warnings** ([detalle](lint-y-tipos.md)) |
| `next build` (sin variables de entorno) | **Falla** (`supabaseUrl is required`) — [H5](hallazgos/H5-build-sin-env.md) |
| Búsqueda de secretos en historial de git | Ninguno (`.env*` ignorado y nunca añadido) |
| Grafo de código (`code-review-graph`) | 48 archivos, 259 nodos, 2036 aristas, 19 comunidades, 52 flujos |

Para poder ejecutar las herramientas se instaló `node_modules` con `npm ci` (ignorado por git) y se borró
`.next` tras el build de prueba. El repositorio no se modificó.

### Limitaciones (qué NO se verificó)

- **Base de datos real:** no hubo acceso al proyecto Supabase. Se desconoce si `fix_rls_policies.sql` se
  aplicó tal cual, si el registro exige confirmar el email, si hay *anonymous sign-ins*, el plan/backups y el
  estado de los índices. Todo lo dependiente está marcado **[Por verificar]**.
- **Web Vitals y tamaño de bundle:** no se midieron (el build falla sin variables de entorno y no se
  ejecutó Lighthouse).
- **Ejecución del checkout:** el defecto `.eq('variant_id', null)` se confirmó en el código de
  `postgrest-js`, pero su efecto en la base real requiere la prueba de [`verificar-checkout.md`](../05-guias/verificar-checkout.md).

## Hallazgos

| ID | Severidad | Área | Título | Esfuerzo | Estado |
|---|---|---|---|---|---|
| [C1](hallazgos/C1-rls-permisivo.md) | Crítico | Seguridad | RLS permite todo a cualquier autenticado; escalada de rol; registro abierto | M | Verificado |
| [C2](hallazgos/C2-checkout-no-atomico.md) | Crítico | Lógica de negocio | Checkout/reembolso no atómicos; stock probablemente sin descontar; totales del cliente | M | Verificado |
| [C3](hallazgos/C3-dependencias-vulnerables.md) | Crítico | Dependencias | Next.js 16.1.6 y transitivas vulnerables | S | En curso |
| [H1](hallazgos/H1-sin-proteccion-servidor.md) | Alto | Seguridad | Sin protección de rutas en servidor; sesión en `localStorage` | M | Verificado |
| [H2](hallazgos/H2-sin-validacion.md) | Alto | Seguridad/Calidad | Cero validación de entrada; zod instalado sin uso | M | Verificado |
| [H3](hallazgos/H3-impuestos-y-dinero.md) | Alto | Lógica de negocio | Impuestos inconsistentes; float; `DECIMAL(5,2)` | M | En curso |
| [H4](hallazgos/H4-flujos-incompletos.md) | Alto | Funcional | Recuperar contraseña roto; ajustes falsos; sin alta de stock; compras/gastos sin UI | M | En curso |
| [H5](hallazgos/H5-build-sin-env.md) | Alto | DevOps | El build falla sin variables de entorno | S | En curso |
| [M1–M18](hallazgos/medios-y-bajos.md) | Medio/Bajo | Varias | 18 hallazgos menores | S–L | Abierto |

Convención de estado: **Abierto → En curso → Corregido → Verificado**. Al cerrar un hallazgo, actualizar
esta tabla y su archivo con el commit/PR que lo corrige.

## Puntuación (subjetiva)

| Área | Nota /10 | Justificación breve |
|---|---|---|
| Seguridad | 2 | Sin autorización efectiva, escalada de rol, dependencias vulnerables, sin headers ni validación |
| Arquitectura | 4 | Ordenada y consistente, pero 100 % cliente, sin capa de datos y con duplicación |
| Base de datos | 4 | Esquema razonable; sin `CHECK`, sin migraciones, RLS contradictoria |
| Testing | 0 | Cero pruebas |
| Performance | 5 | Escala pequeña OK; sin paginación y con agregaciones en el navegador |
| DevOps | 1 | Sin CI, sin monitoreo, build frágil |
| Documentación | 4 | README extenso pero inexacto (ver [readme-vs-realidad](readme-vs-realidad.md)) |

## Otros documentos de esta auditoría

- [Dependencias / `npm audit`](dependencias-npm-audit.md)
- [Lint y tipos](lint-y-tipos.md)
- [README vs realidad](readme-vs-realidad.md)
- [Fortalezas](fortalezas.md)
- [Checklist final](checklist-final.md)

## Correcciones respecto a la versión preliminar (informe en chat)

Tras la lectura completa de los archivos restantes se afinaron estas cifras:

- "29 archivos `use client`" incluía 12 componentes de `components/ui/` y `theme-provider`. El dato correcto:
  **15 de 16 páginas + el layout del dashboard** son Client Components (solo `/` es Server).
- Se añadieron hallazgos que no estaban en el informe preliminar: cadenas vacías contra columnas
  `UNIQUE`/`uuid` en formularios (M14), KPI "Low Stock" topado en 5 y top productos que incluye ventas
  reembolsadas (M6), columna "Loyalty Points" de reportes que muestra `total_spent` (M6), impresión posterior
  a vaciar el carrito (M18), y las afirmaciones falsas del README (ver [readme-vs-realidad](readme-vs-realidad.md)).
