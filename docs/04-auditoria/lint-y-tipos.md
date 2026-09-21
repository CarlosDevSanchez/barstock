# Resultado de `tsc` y `eslint`

> Ejecutado el 2026-09-21 tras `npm ci` (commit `54962b9`). Confianza: **[Verificado]**.

## TypeScript

```bash
./node_modules/.bin/tsc --noEmit    # exit 0, sin errores
```

`strict: true`. Aun así hay 24 `any` explícitos (ver ESLint), varios ocultando la falta de tipos generados
para los *embeds* de Supabase (`orders`, `order_items`, `inventory`).

## ESLint

```bash
./node_modules/.bin/eslint .        # 42 problemas: 32 errores, 10 warnings
```

`npm run lint` **falla** hoy.

> **Actualización etapa 1 (Bun + tooling restrictivo):** con `eslint . --max-warnings 0`, `no-floating-promises`,
> `no-explicit-any` como error y la restricción de imports de Supabase en las capas de UI, el recuento pasa a **93 errores**,
> todos en `app/(auth)`, `app/(dashboard)` y `types/index.ts`. Se eliminan con el refactor a API (Paso 5). `tsc` sigue limpio con
> `noUncheckedIndexedAccess` (un único ajuste en `stores/cart.ts`).
>
> **Actualización (refactor a API, Paso 5):** `bun run lint` termina con **0 errores y 0 warnings**. Los errores de las páginas cliente desaparecieron al
> reescribirlas (sin `any`, sin `fetch` en efectos, datos vía `useApiQuery`).

### Por regla

| Cantidad | Nivel | Regla | Causa típica |
|---|---|---|---|
| 24 | error | `@typescript-eslint/no-explicit-any` | `catch (error: any)` (13), `useState<any[]>`, `as any` en respuestas de Supabase, `types/index.ts:194` (`Settings.value: any`) |
| 6 | error | `react/no-unescaped-entities` | Apóstrofes en JSX (`Don't`, `Today's`, `Here's`) |
| 2 | error | `react-hooks/immutability` | `fetchOrders` (`orders/page.tsx:21`) y `fetchInventory` (`inventory/page.tsx`) se usan en un `useEffect` **antes** de su declaración |
| 10 | warning | `@typescript-eslint/no-unused-vars` | Imports sin usar (`Badge`, `Receipt`, `cn` en POS; `FileText` en órdenes; `Edit` en clientes; etc.) |

### Por archivo (errores / warnings)

| Err. | Warn. | Archivo |
|---|---|---|
| 7 | 1 | `app/(dashboard)/dashboard/page.tsx` |
| 4 | 0 | `app/(dashboard)/orders/[id]/page.tsx` |
| 3 | 0 | `app/(auth)/forgot-password/page.tsx` |
| 2 | 3 | `app/(dashboard)/pos/page.tsx` |
| 2 | 2 | `app/(dashboard)/inventory/page.tsx` |
| 2 | 1 | `app/(auth)/login/page.tsx` |
| 2 | 1 | `app/(dashboard)/orders/page.tsx` |
| 2 | 0 | `app/(dashboard)/categories/page.tsx` |
| 2 | 0 | `app/(dashboard)/products/page.tsx` |
| 1 | 1 | `app/(auth)/register/page.tsx` |
| 1 | 1 | `app/(dashboard)/customers/page.tsx` |
| 1 | 0 | `app/(dashboard)/customers/[id]/page.tsx` |
| 1 | 0 | `app/(dashboard)/reports/page.tsx` |
| 1 | 0 | `app/(dashboard)/suppliers/page.tsx` |
| 1 | 0 | `types/index.ts` |

## Cómo dejarlo en verde

1. `./node_modules/.bin/eslint . --fix` (resuelve imports sin usar y algunas comillas).
2. Reemplazar `catch (error: any)` por `catch (error)` + `getErrorMessage(error: unknown): string`.
3. Generar tipos: `supabase gen types typescript --linked > types/database.ts` y tipar `createClient<Database>()`;
   eso elimina los `as any` de los embeds.
4. Mover cada `fetchX` **dentro** del `useEffect` o declararla antes (o usar `useCallback`).
5. Escapar apóstrofes (`&apos;`) o usar comillas tipográficas.
6. `Settings.value`: `unknown` o `Json` de los tipos generados.
7. Añadir `lint` y `tsc --noEmit` al CI y hacerlos bloqueantes.
