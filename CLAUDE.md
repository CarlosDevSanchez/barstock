# CLAUDE.md — barstock

@AGENTS.md

> Lo anterior importa `AGENTS.md`, que contiene la guía completa del proyecto (stack, comandos, arquitectura, reglas duras, trampas
> conocidas y mapa de documentación). Este archivo añade **solo** lo específico de Claude Code para no duplicar contenido ni
> desincronizarlo. La documentación detallada vive en [`docs/`](docs/README.md).

## Cómo trabajar en este repositorio con Claude Code

### Orden de lectura al empezar una tarea
1. `AGENTS.md` (ya importado): §1 estado real, §6 reglas duras, §8 trampas conocidas.
2. La fila correspondiente de la tabla **"Antes de tocar X, lee Y"** (`AGENTS.md` §9).
3. Solo entonces abrir código. Si la tarea toca datos, dinero o permisos, leer también el hallazgo de auditoría asociado.

### Grafo de código (`code-review-graph`, MCP)
Las instrucciones globales del usuario piden usar el grafo **antes** de `Grep/Glob/Read` para explorar código. Está habilitado en
`.claude/settings.local.json` y se reconstruyó el 2026-09-21 tras la etapa 1 (164 archivos, 1159 nodos, 11 203 aristas, 11 comunidades, 116 flujos).

| Necesidad | Herramienta |
|---|---|
| Buscar funciones/componentes por nombre | `semantic_search_nodes_tool` |
| Llamadores, dependencias, tests de un símbolo | `query_graph_tool` (`callers_of`, `callees_of`, `imports_of`, `tests_for`) |
| Radio de impacto de un cambio | `get_impact_radius_tool`, `get_affected_flows_tool` |
| Revisión de cambios | `detect_changes_tool` + `get_review_context_tool` |
| Funciones grandes | `find_large_functions_tool` |

Límites: **no** cubre bien SQL, configuración ni Markdown → para
`supabase/migrations/*.sql`, `package.json`, `tsconfig.json`, `playwright.config.ts` y `docs/` usar `Read`/`Grep`. Tras cambios grandes, ejecutar
`build_or_update_graph_tool` (incremental por defecto). El directorio `.code-review-graph/` es generado.

### Acuerdos de trabajo
- **Idioma:** responder y documentar en **español**; código, commits y nombres en inglés; la UI es ES/EN (`profiles.locale`, `next-intl`).
- **No hacer commit ni push sin que se pida.** Si se pide, terminar el mensaje con la línea `Co-Authored-By` que indique el arnés.
- **Acciones sobre la base de datos:** solo lectura contra el proyecto real. Las pruebas de integración/e2e escriben datos y **solo se ejecutan contra el Supabase local** (`bun run db:start`; se niegan a correr contra otro host). No apliques migraciones a la base real sin que se pida: es un paso controlado ([guía](docs/05-guias/verificar-checkout.md)).
- **Confianza en lo documentado:** respetar las etiquetas `[Verificado]` / `[Inferido]` / `[Por verificar]`. Si compruebas una hipótesis,
  actualiza la etiqueta en el documento.
- **Al terminar una tarea:** revisar `AGENTS.md` §10 (definición de hecho) y §11 (documentación viva) antes de dar el trabajo por cerrado.
- **Informar con fidelidad:** si `lint`, `build` o una prueba falla, decirlo con la salida. Hoy `format:check`, `lint`, `typecheck`, `test`, `test:e2e`, `build` y `bun audit` pasan en local; si algo falla, es **nuevo**.
  Un test que pasa una vez no basta: los de concurrencia y los que comparten la BD local se comprueban repitiéndolos o **rompiendo la protección a propósito** ([testing](docs/05-guias/testing.md)).

### Herramientas y trampas del entorno
- Gestor de paquetes: **Bun**. Instalar antes de verificar: `bun install --frozen-lockfile`. Después `bun run typecheck`, no `npx tsc` (descarga un paquete falso).
- En zsh, entrecomillar los globs (`--include='*.tsx'`); si no, el comando falla con `no matches found`.
- **`bun test` mezcla procesos:** usar los scripts (`test:unit`, `test:components`, `test:integration`, `test:e2e`); los `mock.module` de Bun son globales al proceso ([testing](docs/05-guias/testing.md)).
- `next dev` **no** debe escribir en `AGENTS.md`/`CLAUDE.md` (`agentRules: false` en `next.config.ts`); si vuelve a aparecer un bloque «This is NOT the Next.js you know», revertirlo.
- Un servidor `next start` viejo puede seguir escuchando en el puerto 3000 y servir un build anterior: `lsof -nP -iTCP:3000 -sTCP:LISTEN` antes de probar.
- `next dev`/`next build` validan el entorno con zod (`lib/env/schema.ts`): necesitan las 4 variables de `.env.example` (copiarlo a `.env.local`); si falta alguna, el error la nombra ([H5](docs/04-auditoria/hallazgos/H5-build-sin-env.md)).
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
