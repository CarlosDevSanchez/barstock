# C3 — Dependencias vulnerables (Next.js 16.1.6 y transitivas)

| | |
|---|---|
| **Severidad** | Crítico (según `npm audit`); aplicabilidad real **Media** |
| **Área** | Seguridad — cadena de suministro |
| **Esfuerzo** | Pequeño |
| **Estado** | En curso (Next 16.3.5 aplicado, `bun audit` limpio; falta la auditoría en CI y `lint`) |
| **Confianza** | **[Verificado]** con `npm audit` sobre `package-lock.json` (2026-09-21) |

## Impacto

El paquete `next` instalado acumula más de 30 avisos de seguridad publicados, 2 críticos:

- RCE sin autenticación en la **Image Optimization API** cuando se usan archivos AVIF (`GHSA-2xp9-vwfh-vxw4`).
- RCE sin autenticación en servidores alojados en **Windows** (`GHSA-p293-qw3h-jr36`).

También hay avisos *high* de DoS con Server Components/Server Actions, *bypass* de Middleware/Proxy,
SSRF en rewrites y WebSockets, y envenenamiento de caché.

## Aplicabilidad a este proyecto

El proyecto **no usa** middleware/proxy, Server Actions, rewrites, `next/image` ni `output: standalone`,
por lo que muchos avisos no le afectan. Sin embargo:

- El endpoint de optimización de imágenes (`/_next/image`) está activo por defecto aunque no se use `next/image`.
- Los avisos de la cadena de herramientas (`sharp`, `postcss`, `ws`, `nanoid`, `minimatch`, `picomatch`…) son
  transitivos y su explotabilidad depende del uso en build/dev.
- Cuando se añada `proxy.ts` para [H1](H1-sin-proteccion-servidor.md), varios avisos de *bypass* pasarán a ser directamente aplicables.

Detalle por paquete en [`dependencias-npm-audit.md`](../dependencias-npm-audit.md).

## Recomendación

```bash
git checkout -b chore/upgrade-next
bun add next@16.3.5 eslint-config-next@16.3.5
bun audit                # revisar lo que quede (no usar overrides a ciegas)
bun run lint && bun run typecheck && bun run build   # con variables de entorno definidas
```

`npm audit` (al auditar) indicó que `next@16.3.5` es la corrección disponible y **no es un cambio de versión mayor**
(`isSemVerMajor: false`). No usar `--force`.

Además:
1. Añadir `bun audit --audit-level=high` al CI (bloqueante en `main`).
2. Activar Dependabot (ecosistema `bun`) o Renovate.
3. `lucide-react` está en `^0.563.0` y hay una `1.x` publicada: actualizar con prueba visual, no urgente.
4. Revisar `engines`/`.nvmrc` (falta) para fijar la versión de Node.

## Criterios de aceptación

- [x] `bun audit --audit-level=high` sin hallazgos (548 paquetes; etapa 1, Paso 2).
- [x] `next` ≥ 16.3.5 en `package.json` y `bun.lock` (`next@16.3.5`, `react@19.3.0`, resto de minors al día).
- [ ] CI ejecuta la auditoría en cada PR.
- [ ] La aplicación pasa `lint`, `tsc` y `build` tras la actualización. (`tsc` y `build` ✅; `lint` sigue fallando por errores de las páginas cliente, ver [lint](../lint-y-tipos.md).)
