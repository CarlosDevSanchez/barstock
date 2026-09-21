# Dependencias y `npm audit`

> Ejecutado el 2026-09-21 sobre `package-lock.json` (commit `54962b9`), Node `v24.11.0`. Confianza: **[Verificado]**.
> Relacionado: hallazgo [C3](hallazgos/C3-dependencias-vulnerables.md).

## Resumen

`npm audit`: **15 paquetes** afectados — 1 crítico, 10 high, 3 moderate, 1 low. Solo `next` es dependencia **directa**;
el resto son transitivas.

| Paquete | Severidad | Rango afectado | Directa | Origen / nota |
|---|---|---|---|---|
| `next` | **Crítica** | `9.3.4-canary.0 – 16.3.2` | Sí | Corrección: `16.3.5` (no es salto mayor). Ver avisos abajo |
| `sharp` | High | `<= 0.35.4-rc.0` | No | Vía `next` (libvips/libheif). Se corrige con `next@16.3.5` |
| `postcss` | High | `<= 8.5.22` | No | Vía `next`. Se corrige con `next@16.3.5` |
| `ws` | High | `8.0.0 – 8.20.1` | No | DoS por memoria; `npm audit fix` disponible |
| `nanoid` | High | `<= 3.3.17` | No | Generadores; `npm audit fix` disponible |
| `brace-expansion` | High | `<= 1.1.17`, `2.0.0 – 2.1.3` | No | Cadena de ESLint/glob |
| `minimatch` | High | `<= 3.1.3`, `9.0.0 – 9.0.6` | No | Cadena de ESLint |
| `picomatch` | High | `<= 2.3.1`, `4.0.0 – 4.0.3` | No | Cadena de herramientas |
| `js-yaml` | High | `4.0.0 – 4.3.1` | No | Cadena de ESLint |
| `flatted` | High | `<= 3.4.1` | No | Cadena de ESLint (`flat-cache`) |
| `browserslist` | High | `<= 4.28.6` | No | Cadena de herramientas |
| `@humanfs/node` | Moderate | `< 0.16.8` | No | Cadena de ESLint |
| `ajv` | Moderate | `< 6.14.0` | No | Cadena de ESLint |
| `baseline-browser-mapping` | Moderate | `>= 2.0.0 < 2.11.0` | No | Cadena de herramientas |
| `@babel/core` | Low | `<= 7.29.0` | No | Cadena de herramientas |

> Los detalles de corrección de los transitivos de ESLint/herramientas no se consultaron uno a uno; ejecutar
> `npm audit` y `npm audit fix` en una rama y revisar el diff del lockfile.

## Avisos relevantes de `next@16.1.6` (extracto de 30+)

| Severidad | Tema |
|---|---|
| **Crítica** | RCE sin autenticación en la Image Optimization API con archivos AVIF (`GHSA-2xp9-vwfh-vxw4`) |
| **Crítica** | RCE sin autenticación en servidores alojados en Windows (`GHSA-p293-qw3h-jr36`) |
| High | Bypass de Middleware/Proxy (segment-prefetch, parámetros de ruta dinámicos, i18n, Turbopack con un solo locale): `GHSA-26hh-7cqf-hhc6`, `GHSA-267c-6grr-h53f`, `GHSA-492v-c6pp-mqqv`, `GHSA-36qx-fr4f-26g5`, `GHSA-6gpp-xcg3-4w24` |
| High | DoS con Server Components, Server Actions y Cache Components: `GHSA-q4gf-8mx6-v5v3`, `GHSA-8h8q-6873-q5fj`, `GHSA-m99w-x7hq-7vfj`, `GHSA-mg66-mrh9-m8jx` |
| High | SSRF en rewrites, WebSockets y Server Actions en servidores personalizados: `GHSA-p9j2-gv94-2wf4`, `GHSA-c4j6-fc7j-m34r`, `GHSA-89xv-2m56-2m9x` |
| Moderate | XSS con nonces de CSP y en scripts `beforeInteractive`; CSRF de Server Actions con origen `null`; envenenamiento/confusión de caché; DoS en Image Optimization; divulgación de endpoints internos |
| Low | Envenenamiento de caché en redirecciones de Middleware; CSRF del websocket HMR en desarrollo |

Lista completa con enlaces: `npm audit --json` (campo `vulnerabilities.next.via`).

### Aplicabilidad hoy

El proyecto no usa middleware/proxy, Server Actions, rewrites ni `next/image`; el endpoint `/_next/image` sí está disponible
por defecto. Al añadir `proxy.ts` ([H1](hallazgos/H1-sin-proteccion-servidor.md)) los avisos de bypass pasan a aplicar directamente.

## Paquetes desactualizados

`npm outdated` (tras `npm ci`). Nota: `next`, `react`, `react-dom` y `eslint-config-next` están **fijados sin `^`** en
`package.json`, por lo que `npm update` no los mueve: hay que instalarlos explícitamente.

| Paquete | Actual | Wanted | Latest | Comentario |
|---|---|---|---|---|
| `next` | 16.1.6 | 16.1.6 | **16.3.5** | Fijado; actualizar explícitamente (C3) |
| `eslint-config-next` | 16.1.6 | 16.1.6 | 16.3.5 | Mantener alineado con `next` |
| `react` / `react-dom` | 19.2.3 | 19.2.3 | 19.3.0 | Fijados; actualizar con pruebas |
| `@supabase/supabase-js` | 2.93.3 | 2.116.0 | 2.116.0 | 23 minors atrás; revisar changelog |
| `zod` | 4.3.6 | 4.6.5 | 4.6.5 | Sin uso hoy |
| `react-hook-form` / `@hookform/resolvers` | 7.71.1 / 5.2.2 | 7.88.0 / 5.9.1 | igual | Sin uso hoy |
| `recharts` | 3.7.0 | 3.10.1 | 3.10.1 | |
| `date-fns` | 4.1.0 | 4.4.0 | 4.4.0 | |
| `tailwindcss` / `@tailwindcss/postcss` | 4.1.18 | 4.3.3 | 4.3.3 | |
| `sonner`, `tailwind-merge`, `@types/react*` | — | — | ver `npm outdated` | Menores |
| `@radix-ui/react-*` (9 paquetes) | 1.1.x / 2.1.x | +8 patches/minors | igual | Actualizar juntos |
| `lucide-react` | 0.563.0 | 0.563.0 | 1.47.0 | Salto mayor; probar íconos |
| `eslint` | 9.39.2 | 9.39.5 | 10.11.0 | Mantener en 9 hasta que el ecosistema soporte 10 |
| `typescript` | 5.9.3 | 5.9.3 | 7.0.2 | Salto mayor; evaluar aparte |
| `@types/node` | 20.19.30 | 20.19.43 | 26.6.2 | Alinear con la versión de Node soportada |

## Cadena de suministro

- `package-lock.json` versionado (315 KB): builds reproducibles con `npm ci`.
- Sin `overrides`, sin `.npmrc`, sin verificación de firmas/procedencia.
- Sin escaneo de licencias (README declara MIT pero **no hay archivo `LICENSE`**).
- Sin Dependabot/Renovate.
- Dependencias instaladas sin uso (`zod`, `react-hook-form`, `@hookform/resolvers`): aumentan superficie sin aportar; usarlas o quitarlas.
- Node requerido por Next 16: `>=20.9.0`. Sin `engines` ni `.nvmrc` en el proyecto.

## Recomendaciones

1. Aplicar [C3](hallazgos/C3-dependencias-vulnerables.md).
2. CI: `npm ci && npm audit --audit-level=high`.
3. Dependabot semanal agrupado (radix, tailwind, supabase).
4. Añadir `LICENSE` o retirar la declaración del README.
5. Fijar Node en `engines` y `.nvmrc`.
