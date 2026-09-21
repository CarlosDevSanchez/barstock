# CLAUDE.md — barstock

@AGENTS.md

> Lo anterior importa `AGENTS.md`, que contiene la guía completa del proyecto (stack, comandos, arquitectura, reglas duras, trampas
> conocidas y mapa de documentación). Este archivo añade **solo** lo específico de Claude Code para no duplicar contenido ni
> desincronizarlo. La documentación detallada vive en [`docs/`](docs/README.md).

## Cómo trabajar en este repositorio con Claude Code

### Orden de lectura al empezar una tarea
1. `AGENTS.md` (ya importado): §6 reglas duras, §8 trampas conocidas.
2. La fila correspondiente de la tabla **"Antes de tocar X, lee Y"** (`AGENTS.md` §9).
3. Solo entonces abrir código. Si la tarea toca datos, dinero o permisos, leer también el hallazgo de auditoría asociado.

### Grafo de código (`code-review-graph`, MCP)
Las instrucciones globales del usuario piden usar el grafo **antes** de `Grep/Glob/Read` para explorar código. Está habilitado en
`.claude/settings.local.json` y se reconstruyó el 2026-09-21 (48 archivos, 259 nodos, 2036 aristas, 19 comunidades, 52 flujos).

| Necesidad | Herramienta |
|---|---|
| Buscar funciones/componentes por nombre | `semantic_search_nodes_tool` |
| Llamadores, dependencias, tests de un símbolo | `query_graph_tool` (`callers_of`, `callees_of`, `imports_of`, `tests_for`) |
| Radio de impacto de un cambio | `get_impact_radius_tool`, `get_affected_flows_tool` |
| Revisión de cambios | `detect_changes_tool` + `get_review_context_tool` |
| Funciones grandes | `find_large_functions_tool` |

Límites: el grafo indexa 48 de los 61 archivos versionados; **no** cubre bien SQL, configuración ni Markdown → para
`supabase/*.sql`, `package.json`, `tsconfig.json` y `docs/` usar `Read`/`Grep`. Tras cambios grandes, ejecutar
`build_or_update_graph_tool` (incremental por defecto). El directorio `.code-review-graph/` es generado.

### Acuerdos de trabajo
- **Idioma:** responder y documentar en **español**; código, commits y nombres en inglés; la UI se queda en inglés hasta decidir lo contrario.
- **No hacer commit ni push sin que se pida.** Si se pide, terminar el mensaje con la línea `Co-Authored-By` que indique el arnés.
- **Acciones sobre la base de datos:** solo lectura contra el proyecto real. Las pruebas de escritura son solo para desarrollo/staging.
- **Confianza en lo documentado:** respetar las etiquetas `[Verificado]` / `[Inferido]` / `[Por verificar]`. Si compruebas una hipótesis,
  actualiza la etiqueta en el documento.
- **Al terminar una tarea:** revisar `AGENTS.md` §10 (definición de hecho) y §11 (documentación viva) antes de dar el trabajo por cerrado.
- **Informar con fidelidad:** si `lint`, `build` o una prueba falla, decirlo con la salida. Hoy `bun run lint` y `bun audit` **ya fallan** por
  causas conocidas ([lint](docs/04-auditoria/lint-y-tipos.md), [C3](docs/04-auditoria/hallazgos/C3-dependencias-vulnerables.md)); distinguir
  "falla nuevo" de "falla existente".

### Herramientas y trampas del entorno
- Gestor de paquetes: **Bun**. Instalar antes de verificar: `bun install --frozen-lockfile`. Después `bun run typecheck`, no `npx tsc` (descarga un paquete falso).
- En zsh, entrecomillar los globs (`--include='*.tsx'`); si no, el comando falla con `no matches found`.
- `next build` necesita `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`; sin ellas falla ([H5](docs/04-auditoria/hallazgos/H5-build-sin-env.md)).
- Tras un `next build` local, borrar `.next/` si no se necesita (está en `.gitignore`, no ensucia git).

### Skills útiles (si están disponibles en la sesión)
`security-auditor` (RLS, autenticación), `schema-auditor` / `data-architecture-auditor` (esquema y migraciones), `dependency-auditor`
(`bun audit`), `react-best-practices` (Server vs Client Components, rendimiento), `systematic-debugging` (antes de proponer un arreglo),
`test-driven-development` (RPC y cálculos), `verification-before-completion` y `review-changes` (antes de cerrar).

### Convenciones para editar documentación
- Un tema, un archivo bajo `docs/`; enlazar en lugar de copiar. Índice único en `docs/README.md`: añadir ahí todo archivo nuevo.
- Enlaces relativos; comprobar que no queden rotos tras mover o renombrar.
- Referencias `archivo:línea` basadas en el commit `54962b9`; actualizar si el código cambia.
- No mezclar hallazgos nuevos en un documento de módulo: crear el hallazgo en `docs/04-auditoria/hallazgos/` y enlazarlo.
