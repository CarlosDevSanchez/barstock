# Checklist final de auditoría

> Leyenda: ✅ cumple · ⚠️ parcial · ❌ no cumple · ➖ no aplica · ❓ no verificado (requiere acceso a Supabase/entorno).
> Commit `54962b9` · 2026-09-21. Referencias a hallazgos entre corchetes.

## Estado tras la etapa 1 (actualizado)

Las tablas de más abajo son el **registro original** (commit `54962b9`). Esta es la misma lista con el estado actual. ✅* = hecho y probado en local; falta la primera ejecución real en GitHub o en producción.

| Área | Punto | Antes | Ahora | Nota |
|---|---|---|---|---|
| Seguridad | Validación de entrada en todos los endpoints | ❌ | ✅ | `route()` valida body, query y params con zod; `422` con detalle por campo |
| | No hay secretos en código | ✅ | ✅ | `.env*` ignorado (salvo `.env.example`); el CI no usa secretos |
| | CORS | ➖ | ➖ | Sin CORS: la API es del mismo origen; las escrituras de otro origen se rechazan (403) |
| | Security headers | ❌ | ⚠️ | CSP, `frame-ancestors`, `nosniff`, `Referrer-Policy`, HSTS, `Permissions-Policy`. La CSP conserva `'unsafe-inline'` en scripts ([M9](hallazgos/medios-y-bajos.md)) |
| | Autenticación | ⚠️ | ✅ | Sesión en cookies, `proxy.ts`, `getUser()` en cada petición |
| | Autorización | ❌ | ✅ | Roles jerárquicos en `route()`, en RLS y en la navegación ([C1]) |
| | Sin vulnerabilidades conocidas en dependencias | ❌ | ✅ | `bun audit` limpio en el CI ([C3]) |
| | Rate limiting / fuerza bruta en login | ❓ | ⚠️ | Solo el de Supabase Auth (`429`); no hay uno propio |
| | Protección CSRF | ➖/⚠️ | ✅ | Comprobación de `Origin`, `SameSite=Lax`, JSON; probado |
| | Sesión en almacenamiento seguro (`httpOnly`) | ❌ | ✅ | Cookies `HttpOnly` (+ `Secure` en producción); `localStorage` sin tokens; verificado en Chromium |
| | Sin escalada de privilegios | ❌ | ✅ | Trigger de perfiles + RLS; `rls.test.ts` |
| Arquitectura | Estructura clara y escalable | ⚠️ | ✅ | API + servicios + validación compartida |
| | Separación de concerns | ❌ | ✅ | Lint prohíbe Supabase en la UI |
| | Sin código duplicado significativo | ❌ | ⚠️ | Spinner, diálogos, formularios y listas compartidos; la navegación sigue duplicada entre escritorio y móvil |
| | Componentes con responsabilidad única | ❌ | ⚠️ | Páginas de 150–440 líneas (antes 120–420, ahora sin lógica de datos) |
| | Server vs Client Components | ❌ | ⚠️ | El layout es Server Component; las páginas son interactivas y siguen siendo cliente |
| | Lógica de negocio fuera del cliente | ❌ | ✅ | RPC transaccionales; el cliente solo hace una vista previa |
| Base de datos | Índices apropiados | ⚠️ | ✅ | [M2](hallazgos/medios-y-bajos.md) |
| | Migraciones versionadas | ❌ | ✅* | `supabase/migrations/`; falta aplicarlas a la base real |
| | Backup strategy documentada | ❓ | ❓ | Sigue sin decidirse (D18) |
| | Performance aceptable | ⚠️ | ⚠️ | Paginación y agregación en SQL; **sin medir con datos reales** |
| | Constraints de integridad | ❌ | ✅ | `CHECK`, `NOT NULL`, únicos parciales; probados |
| | Transacciones donde hacen falta | ❌ | ✅ | `create_sale`, `refund_order`, `adjust_inventory` ([C2]) |
| | Campos de auditoría / soft delete | ⚠️ | ✅ | `deleted_at` en productos, `refunded_by/at/reason`, `created_by`, bitácora de movimientos |
| Código | TypeScript strict | ✅ | ✅ | + `noUncheckedIndexedAccess`, `noImplicitReturns` |
| | Uso mínimo de `any` | ❌ | ✅ | 0 (regla ESLint como error) |
| | Manejo de errores completo | ❌ | ✅ | `assertNoError`, mapeo sin mensajes crudos |
| | Lógica de negocio testeable | ❌ | ✅ | En servicios y RPC, con pruebas |
| | Sin números mágicos | ❌ | ⚠️ | Tasa, moneda y umbral vienen de Ajustes; quedan constantes locales (tamaños de página, límites) |
| | Sin race conditions | ❌ | ✅ | Probado con concurrencia y mutaciones deliberadas |
| Testing | Cobertura | ❌ | ✅ | ≥ 80 % exigido en `lib/server` (96,8 %) y `lib/validation` (99,1 %); **no hay cifra global** |
| | Tests de funcionalidad crítica | ❌ | ✅ | Venta, reembolso, permisos, invitación (264 pruebas) |
| | CI/CD ejecuta tests | ❌ | ✅* | `.github/workflows/ci.yml` |
| | Tests no frágiles | ➖ | ⚠️ | Comparten una BD local que crece; los de reportes usan un día aislado. Se detectó y corrigió uno frágil |
| Performance | Web Vitals / bundle | ❓ | ❓ | Sin medir |
| | Queries optimizadas | ❌ | ⚠️ | Paginadas y agregadas; varios servicios aún usan `select('*')` |
| | Caching | ❌ | ❌ | Ninguno (respuestas `no-store`); sin SWR/React Query |
| Deployment | CI/CD pipeline | ❌ | ✅* | |
| | Ambientes separados | ❓ | ❓ | D13 |
| | Rollback | ❓ | ❓ | Migraciones sin `down` |
| | Logs centralizados / Monitoring | ❌ | ❌ | Sin Sentry/APM; solo `console.error` en el servidor |
| | Build reproducible | ⚠️ | ✅ | `--frozen-lockfile`, versiones exactas, variables validadas |
| Documentación | README claro y actualizado | ❌ | ✅ | Reescrito |
| | Contributing / setup | ❌ | ✅ | [convenciones](../05-guias/convenciones-de-codigo.md), [setup-local](../05-guias/setup-local.md) |
| | Decisiones documentadas | ⚠️ | ⚠️ | Supuestos aplicados y pendientes en [decisiones](../06-roadmap/decisiones-pendientes.md) |

---

## Registro original (commit `54962b9`)

## Seguridad

| Punto | Estado | Nota |
|---|---|---|
| Validación de entrada en todos los endpoints | ❌ | Sin validación ([H2]); no hay endpoints propios, todo va a Supabase |
| No hay secretos en código | ✅ | Sin `.env` en el historial; solo anon key |
| CORS configurado correctamente | ➖ | Sin API routes; CORS lo gestiona Supabase (revisar orígenes permitidos: ❓) |
| Security headers presentes | ❌ | `next.config.ts` vacío ([M9]) |
| Autenticación implementada | ⚠️ | Supabase Auth OK; sin guarda en servidor ([H1]) |
| Autorización implementada | ❌ | RLS permisiva, roles cosméticos ([C1]) |
| Sin vulnerabilidades conocidas en dependencias | ❌ | 15 paquetes; `next` crítico ([C3]) |
| Rate limiting en endpoints sensibles | ❓ | Solo los límites por defecto de Supabase Auth |
| Logs no contienen información sensible | ✅ | Solo 5 `console.*`, sin datos sensibles; sin logging estructurado |
| Protección de fuerza bruta en login | ❓ | Depende de Supabase Auth |
| Protección CSRF | ➖/⚠️ | Sin cookies propias; el JWT va en `Authorization`. Cambiará al adoptar cookies ([H1]) |
| Sesión en almacenamiento seguro (`httpOnly`) | ❌ | `localStorage` ([H1]) |
| Sin escalada de privilegios | ❌ | `profiles.role` editable por el propio usuario ([C1]) |

## Arquitectura

| Punto | Estado | Nota |
|---|---|---|
| Estructura escalable y clara | ⚠️ | Clara; sin capa de datos ([M7]) |
| Separación de concerns | ❌ | UI + datos + reglas en cada página |
| Patrones consistentes | ✅ | Muy consistente (a costa de duplicación) |
| Sin código duplicado significativo | ❌ | Layout, spinner, patrón de listado, fórmulas ([estructura]) |
| Componentes con responsabilidad única | ❌ | Páginas de 120–420 líneas |
| Uso adecuado de Server vs Client Components | ❌ | 15 páginas + layout cliente; ninguna lectura en servidor |
| Lógica de negocio fuera del cliente | ❌ | Todo en el navegador ([C2]) |

## Base de datos

| Punto | Estado | Nota |
|---|---|---|
| Esquema normalizado | ✅ | 3FN en general |
| Índices apropiados | ⚠️ | 9 explícitos; 3 redundantes; faltan varios ([M2]) |
| Migraciones versionadas | ❌ | Scripts sueltos ([M4]) |
| Backup strategy documentada | ❓ | No documentada |
| Performance aceptable | ⚠️ | Aceptable a escala pequeña; sin paginación ([M5]) |
| Constraints de integridad (`CHECK`, `NOT NULL`) | ❌ | Ausentes ([M2]) |
| Transacciones donde son necesarias | ❌ | Ninguna ([C2]) |
| Campos de auditoría / soft delete | ⚠️ | `created_at/updated_at` sí; `deleted_at` y quién cambió, no |

## Código

| Punto | Estado | Nota |
|---|---|---|
| TypeScript con modo strict | ✅ | |
| Uso mínimo de `any` | ❌ | 24 ([lint]) |
| Manejo de errores completo | ❌ | Errores de `select` ignorados; toasts con mensaje crudo ([M10]) |
| Funciones de tamaño razonable | ⚠️ | `handleCheckout` ≈ 100 líneas; páginas largas |
| Complejidad controlada | ⚠️ | Anidamiento aceptable; lógica repetida |
| Lógica de negocio testeable | ❌ | Embebida en componentes |
| Sin números mágicos / config centralizada | ❌ | `0.1`, `10`, `$` dispersos; `constants.ts` sin uso ([H3]) |
| Sin race conditions | ❌ | Stock ([C2]) |

## Testing

| Punto | Estado | Nota |
|---|---|---|
| Cobertura > 70 % | ❌ | 0 % |
| Tests de funcionalidad crítica | ❌ | Ninguno |
| CI/CD ejecuta tests | ❌ | No hay CI |
| Tests no frágiles | ➖ | No hay tests |

## Performance

| Punto | Estado | Nota |
|---|---|---|
| Web Vitals dentro de límites | ❓ | No medido |
| Bundle size optimizado | ❓ | No medido (build falla sin env). `recharts` solo en dashboard (candidato a `dynamic`) |
| Database queries optimizadas | ❌ | `select *`, sin paginar, agregaciones en cliente |
| Caching strategy implementada | ❌ | Ninguna (sin SWR/React Query, sin `revalidate`) |
| Imágenes optimizadas | ➖ | No se muestran imágenes de producto ni se usa `next/image` |

## Deployment

| Punto | Estado | Nota |
|---|---|---|
| CI/CD pipeline funcional | ❌ | No existe |
| Ambientes separados | ❓ | No documentados |
| Rollback capability | ❓ | Depende de Vercel; sin migraciones reversibles de BD |
| Logs centralizados | ❌ | |
| Monitoring activo | ❌ | Sin Sentry/APM |
| Dockerfile / orquestación | ➖ | No aplica si se despliega en Vercel |
| Build reproducible | ⚠️ | Lockfile sí; el build falla sin env ([H5]) |

## Documentación

| Punto | Estado | Nota |
|---|---|---|
| README claro y actualizado | ❌ | Inexacto ([readme-vs-realidad]) |
| Contributing guide | ❌ → ⚠️ | Se añade [convenciones](../05-guias/convenciones-de-codigo.md) |
| Setup instructions funcionan | ❌ → ✅ | Corregidas en [setup-local](../05-guias/setup-local.md) |
| Decisiones arquitectónicas documentadas | ⚠️ | [decisiones-pendientes](../06-roadmap/decisiones-pendientes.md) |
| Documentación técnica interna | ✅ | Esta carpeta `docs/` |

[C1]: hallazgos/C1-rls-permisivo.md
[C2]: hallazgos/C2-checkout-no-atomico.md
[C3]: hallazgos/C3-dependencias-vulnerables.md
[H1]: hallazgos/H1-sin-proteccion-servidor.md
[H2]: hallazgos/H2-sin-validacion.md
[H3]: hallazgos/H3-impuestos-y-dinero.md
[M2]: hallazgos/medios-y-bajos.md
[M4]: hallazgos/medios-y-bajos.md
[M5]: hallazgos/medios-y-bajos.md
[M7]: hallazgos/medios-y-bajos.md
[M9]: hallazgos/medios-y-bajos.md
[M10]: hallazgos/medios-y-bajos.md
[lint]: lint-y-tipos.md
[estructura]: ../01-arquitectura/02-estructura-de-carpetas.md
[readme-vs-realidad]: readme-vs-realidad.md
