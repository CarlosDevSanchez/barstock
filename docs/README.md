# Documentación interna — barstock (POS + Inventario)

> **Estado:** rama `feat/i18n-cop` (COP por defecto + i18n ES/EN + Docker local) sobre la etapa 1 · **Revisión:** 2026-09-21. La auditoría de `04-auditoria/` sigue siendo la del commit `54962b9` y es un registro histórico.
> **Idioma:** español para prosa; identificadores, rutas y SQL en inglés tal como están en el código.

Esta carpeta es la fuente de verdad interna del proyecto. Cada archivo cubre **un solo tema** para
poder enlazarlo, actualizarlo y revisarlo por separado. Los archivos `AGENTS.md` y `CLAUDE.md` de la
raíz son el punto de entrada para agentes de IA y apuntan aquí.

## Cómo leer estos documentos

Cada afirmación técnica lleva una de estas etiquetas de confianza cuando importa:

| Etiqueta | Significado |
|---|---|
| **[Verificado]** | Confirmado leyendo el código o ejecutando una herramienta o **una prueba automática** (`tsc`, `eslint`, `bun test`, Playwright, `bun audit`, `next build`) contra una BD local. |
| **[Inferido]** | Se deduce del código pero no se ejecutó. |
| **[Por verificar]** | Hipótesis fundada que requiere una prueba en un entorno real (la **base de producción** todavía no se ha tocado). Procedimiento en [`05-guias/verificar-checkout.md`](05-guias/verificar-checkout.md). |

Las referencias `archivo:línea` de `04-auditoria/` apuntan al commit `54962b9`; en el resto se cita el archivo, no la línea.

## Índice

### 01 · Arquitectura — [`01-arquitectura/`](01-arquitectura/)
| Archivo | Contenido |
|---|---|
| [01-vision-general.md](01-arquitectura/01-vision-general.md) | Qué es el sistema, modelo de ejecución, stack, mapa de rutas, flujos |
| [02-estructura-de-carpetas.md](01-arquitectura/02-estructura-de-carpetas.md) | Árbol comentado, responsabilidad por carpeta, código sin uso |
| [03-autenticacion-y-sesion.md](01-arquitectura/03-autenticacion-y-sesion.md) | Sesión en cookies, login, invitación, recuperación, roles, CSRF |
| [04-estado-cliente.md](01-arquitectura/04-estado-cliente.md) | Carrito, contexto de sesión, `useApiQuery` |
| [05-capa-de-datos.md](01-arquitectura/05-capa-de-datos.md) | Servicios, RPC, errores, paginación y búsqueda |
| [06-ui-y-diseno.md](01-arquitectura/06-ui-y-diseno.md) | shadcn/ui, Tailwind 4, tema, componentes compartidos, patrones de pantalla |
| [07-configuracion-y-tooling.md](01-arquitectura/07-configuracion-y-tooling.md) | tsconfig, ESLint, Next config, scripts, CI y Dependabot |
| [08-api.md](01-arquitectura/08-api.md) | API `/api/v1`: endpoints, contrato, errores, cómo añadir un recurso |
| [09-pwa-offline.md](01-arquitectura/09-pwa-offline.md) | PWA instalable, service worker, lectura offline, avisos de conexión |

### 02 · Base de datos — [`02-base-de-datos/`](02-base-de-datos/)
| Archivo | Contenido |
|---|---|
| [01-esquema-tablas.md](02-base-de-datos/01-esquema-tablas.md) | Las 16 tablas y 4 enums (esquema efectivo tras las migraciones) |
| [02-relaciones-y-diagrama.md](02-base-de-datos/02-relaciones-y-diagrama.md) | Diagrama ER (Mermaid) y reglas de borrado |
| [03-rls-y-politicas.md](02-base-de-datos/03-rls-y-politicas.md) | Roles, matriz de políticas, protección de perfiles, alta cerrada |
| [04-triggers-y-funciones.md](02-base-de-datos/04-triggers-y-funciones.md) | RPC de negocio, reportes, triggers |
| [05-indices-y-constraints.md](02-base-de-datos/05-indices-y-constraints.md) | Índices, `CHECK`, `NOT NULL`, claves foráneas |
| [06-seed-y-migraciones.md](02-base-de-datos/06-seed-y-migraciones.md) | Migraciones, seed, cómo aplicarlas a una base existente |

### 03 · Módulos funcionales — [`03-modulos/`](03-modulos/)
| Archivo | Contenido |
|---|---|
| [pos-checkout.md](03-modulos/pos-checkout.md) | Punto de venta, cálculo del cobro, concurrencia |
| [cuentas-abiertas.md](03-modulos/cuentas-abiertas.md) | Cuentas compartidas, stock al añadir, pagos parciales, cierre a orden |
| [ordenes-y-reembolsos.md](03-modulos/ordenes-y-reembolsos.md) | Listado, detalle, reembolso idempotente |
| [productos.md](03-modulos/productos.md) | CRUD de productos |
| [categorias.md](03-modulos/categorias.md) | CRUD de categorías |
| [promociones.md](03-modulos/promociones.md) | Paquetes multi-producto (admin); venta POS pendiente |
| [inventario.md](03-modulos/inventario.md) | Stock, ajustes con motivo, movimientos |
| [clientes.md](03-modulos/clientes.md) | Listado y detalle de clientes |
| [proveedores-y-compras.md](03-modulos/proveedores-y-compras.md) | Proveedores; órdenes de compra (sin UI) |
| [dashboard.md](03-modulos/dashboard.md) | KPIs y gráficas (agregados en SQL) |
| [reportes.md](03-modulos/reportes.md) | Reportes por rango de fechas |
| [ajustes.md](03-modulos/ajustes.md) | Ajustes de la tienda (persisten) |
| [usuarios.md](03-modulos/usuarios.md) | Invitar, cambiar rol, desactivar |
| [auditoria.md](03-modulos/auditoria.md) | Registro de escrituras y eventos de sesión, solo admin, append-only |

### 04 · Auditoría técnica — [`04-auditoria/`](04-auditoria/)
| Archivo | Contenido |
|---|---|
| [README.md](04-auditoria/README.md) | **Estado tras la etapa 1**, resumen ejecutivo original, alcance, puntuación |
| [hallazgos/](04-auditoria/hallazgos/) | Un archivo por hallazgo (C1–C3, H1–H5, medios/bajos) |
| [dependencias-npm-audit.md](04-auditoria/dependencias-npm-audit.md) | Las 15 vulnerabilidades de entonces y su resolución |
| [lint-y-tipos.md](04-auditoria/lint-y-tipos.md) | Resultado de `tsc` y `eslint` (histórico y actual) |
| [readme-vs-realidad.md](04-auditoria/readme-vs-realidad.md) | (Histórico) Qué afirmaba el README original y qué era cierto |
| [fortalezas.md](04-auditoria/fortalezas.md) | Lo que está bien y conviene conservar |
| [checklist-final.md](04-auditoria/checklist-final.md) | Checklist de auditoría completado |

### 05 · Guías — [`05-guias/`](05-guias/)
| Archivo | Contenido |
|---|---|
| [setup-local.md](05-guias/setup-local.md) | Puesta en marcha para desarrollar (`bun run dev`) |
| [docker-local.md](05-guias/docker-local.md) | Todo en Docker con un comando: Supabase, usuarios de prueba y la app |
| [variables-de-entorno.md](05-guias/variables-de-entorno.md) | Variables requeridas y cómo validarlas |
| [comandos.md](05-guias/comandos.md) | Scripts y comandos de verificación |
| [testing.md](05-guias/testing.md) | Niveles de prueba, cómo ejecutarlas, seguridad de las pruebas y concurrencia |
| [convenciones-de-codigo.md](05-guias/convenciones-de-codigo.md) | Estilo observado y reglas para código nuevo |
| [verificar-checkout.md](05-guias/verificar-checkout.md) | Verificar los datos de una base existente antes y después de migrar |

### 06 · Roadmap — [`06-roadmap/`](06-roadmap/)
| Archivo | Contenido |
|---|---|
| [plan-de-remediacion.md](06-roadmap/plan-de-remediacion.md) | Fases, tareas, criterios de aceptación |
| [diseno-objetivo-seguridad.md](06-roadmap/diseno-objetivo-seguridad.md) | Borrador de origen de RLS y RPC (**implementado**; manda la migración) |
| [decisiones-pendientes.md](06-roadmap/decisiones-pendientes.md) | Preguntas de producto y supuestos aplicados sin validar |
| [offline-y-sincronizacion.md](06-roadmap/offline-y-sincronizacion.md) | Plan (sin implementar) de cola offline y sincronización para ventas, cuentas y ajustes |

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
