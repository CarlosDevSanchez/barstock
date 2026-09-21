# Documentación interna — barstock (POS + Inventario)

> **Base de esta documentación:** commit `54962b9` (rama `main`) · **Revisión:** 2026-09-21
> **Idioma:** español para prosa; identificadores, rutas y SQL en inglés tal como están en el código.

Esta carpeta es la fuente de verdad interna del proyecto. Cada archivo cubre **un solo tema** para
poder enlazarlo, actualizarlo y revisarlo por separado. Los archivos `AGENTS.md` y `CLAUDE.md` de la
raíz son el punto de entrada para agentes de IA y apuntan aquí.

## Cómo leer estos documentos

Cada afirmación técnica lleva una de estas etiquetas de confianza cuando importa:

| Etiqueta | Significado |
|---|---|
| **[Verificado]** | Confirmado leyendo el código o ejecutando una herramienta (`tsc`, `eslint`, `npm audit`, `next build`). |
| **[Inferido]** | Se deduce del código pero no se ejecutó contra una base de datos real. |
| **[Por verificar]** | Hipótesis fundada que requiere una prueba en el entorno Supabase del proyecto. Cada una tiene un procedimiento en [`05-guias/verificar-checkout.md`](05-guias/verificar-checkout.md) o en su hallazgo. |

Las referencias `archivo:línea` apuntan al commit base; si el código cambia, las líneas se desplazan.

## Índice

### 01 · Arquitectura — [`01-arquitectura/`](01-arquitectura/)
| Archivo | Contenido |
|---|---|
| [01-vision-general.md](01-arquitectura/01-vision-general.md) | Qué es el sistema, stack, mapa de rutas, modelo de confianza |
| [02-estructura-de-carpetas.md](01-arquitectura/02-estructura-de-carpetas.md) | Árbol comentado, tamaños, código muerto |
| [03-autenticacion-y-sesion.md](01-arquitectura/03-autenticacion-y-sesion.md) | Login, registro, recuperación, guarda de rutas, roles |
| [04-estado-cliente.md](01-arquitectura/04-estado-cliente.md) | Los 3 stores de Zustand y la persistencia en `localStorage` |
| [05-capa-de-datos.md](01-arquitectura/05-capa-de-datos.md) | Cómo se accede a Supabase, queries por página, manejo de errores |
| [06-ui-y-diseno.md](01-arquitectura/06-ui-y-diseno.md) | shadcn/ui, Tailwind 4, tema, patrones de pantalla |
| [07-configuracion-y-tooling.md](01-arquitectura/07-configuracion-y-tooling.md) | tsconfig, ESLint, Next config, scripts, `.claude/` |

### 02 · Base de datos — [`02-base-de-datos/`](02-base-de-datos/)
| Archivo | Contenido |
|---|---|
| [01-esquema-tablas.md](02-base-de-datos/01-esquema-tablas.md) | Las 15 tablas y 4 enums, columna por columna |
| [02-relaciones-y-diagrama.md](02-base-de-datos/02-relaciones-y-diagrama.md) | Diagrama ER (Mermaid) y reglas de borrado |
| [03-rls-y-politicas.md](02-base-de-datos/03-rls-y-politicas.md) | Matriz de políticas: `schema.sql` vs `fix_rls_policies.sql` vs efectiva |
| [04-triggers-y-funciones.md](02-base-de-datos/04-triggers-y-funciones.md) | `updated_at`, alta de perfil, `SECURITY DEFINER` |
| [05-indices-y-constraints.md](02-base-de-datos/05-indices-y-constraints.md) | Índices existentes, faltantes y `CHECK` recomendados |
| [06-seed-y-migraciones.md](02-base-de-datos/06-seed-y-migraciones.md) | Datos semilla, orden de ejecución, ausencia de migraciones |

### 03 · Módulos funcionales — [`03-modulos/`](03-modulos/)
| Archivo | Contenido |
|---|---|
| [pos-checkout.md](03-modulos/pos-checkout.md) | Punto de venta y flujo de cobro paso a paso |
| [ordenes-y-reembolsos.md](03-modulos/ordenes-y-reembolsos.md) | Listado, detalle, impresión, reembolso |
| [productos.md](03-modulos/productos.md) | CRUD de productos |
| [categorias.md](03-modulos/categorias.md) | CRUD de categorías |
| [inventario.md](03-modulos/inventario.md) | Vista de stock (solo lectura) |
| [clientes.md](03-modulos/clientes.md) | Listado y detalle de clientes |
| [proveedores-y-compras.md](03-modulos/proveedores-y-compras.md) | Proveedores; órdenes de compra (sin UI) |
| [dashboard.md](03-modulos/dashboard.md) | KPIs y gráficas |
| [reportes.md](03-modulos/reportes.md) | Reportes de 7 días, top productos y clientes |
| [ajustes.md](03-modulos/ajustes.md) | Pantalla de ajustes (no persiste) |

### 04 · Auditoría técnica — [`04-auditoria/`](04-auditoria/)
| Archivo | Contenido |
|---|---|
| [README.md](04-auditoria/README.md) | Resumen ejecutivo, alcance, puntuación, plan |
| [hallazgos/](04-auditoria/hallazgos/) | Un archivo por hallazgo (C1–C3, H1–H5, medios/bajos) |
| [dependencias-npm-audit.md](04-auditoria/dependencias-npm-audit.md) | Detalle de las 15 vulnerabilidades reportadas |
| [lint-y-tipos.md](04-auditoria/lint-y-tipos.md) | Resultado de `tsc` y `eslint` |
| [readme-vs-realidad.md](04-auditoria/readme-vs-realidad.md) | Qué afirma el README y qué es cierto |
| [fortalezas.md](04-auditoria/fortalezas.md) | Lo que está bien y conviene conservar |
| [checklist-final.md](04-auditoria/checklist-final.md) | Checklist de auditoría completado |

### 05 · Guías — [`05-guias/`](05-guias/)
| Archivo | Contenido |
|---|---|
| [setup-local.md](05-guias/setup-local.md) | Puesta en marcha correcta de cero |
| [variables-de-entorno.md](05-guias/variables-de-entorno.md) | Variables requeridas y cómo validarlas |
| [comandos.md](05-guias/comandos.md) | Scripts npm y comandos de verificación |
| [convenciones-de-codigo.md](05-guias/convenciones-de-codigo.md) | Estilo observado y reglas para código nuevo |
| [verificar-checkout.md](05-guias/verificar-checkout.md) | Prueba manual del descuento de stock (hallazgo C2) |

### 06 · Roadmap — [`06-roadmap/`](06-roadmap/)
| Archivo | Contenido |
|---|---|
| [plan-de-remediacion.md](06-roadmap/plan-de-remediacion.md) | Fases, tareas, criterios de aceptación |
| [diseno-objetivo-seguridad.md](06-roadmap/diseno-objetivo-seguridad.md) | Borrador de RLS por rol y de las funciones RPC |
| [decisiones-pendientes.md](06-roadmap/decisiones-pendientes.md) | Preguntas de producto que bloquean decisiones técnicas |

### Otros
- [glosario.md](glosario.md) — términos de dominio y técnicos.

## Mantenimiento de esta documentación

1. **Un tema, un archivo.** Si un documento crece por encima de ~300 líneas, dividirlo.
2. **Actualizar junto con el código.** Un PR que cambie el esquema, las políticas RLS o el flujo de
   cobro debe tocar el documento correspondiente en el mismo PR.
3. **No duplicar.** Enlazar en lugar de copiar. La fuente de cada dato es un único archivo.
4. **Marcar la confianza.** Toda afirmación no probada lleva `[Inferido]` o `[Por verificar]`.
5. **Al cerrar un hallazgo** de auditoría, actualizar su estado en
   [`04-auditoria/README.md`](04-auditoria/README.md) y en su archivo bajo `hallazgos/`.
