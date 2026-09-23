# UI y sistema de diseño

> Actualizado tras la etapa 1. Confianza: **[Verificado]** (código y recorridos en Chromium); la accesibilidad **no** se ha auditado con herramientas.

## Tecnología

- **Tailwind CSS 4** (sin `tailwind.config`): `app/globals.css` importa `tailwindcss` y `tw-animate-css`, define `@custom-variant dark (&:is(.dark *))` y expone los tokens con
  `@theme inline` (`--color-background`, `--color-primary`, `--radius-*`, `--color-sidebar-*`, `--color-chart-1..5`).
- **shadcn/ui**, estilo `new-york`, `baseColor: neutral`, `cssVariables: true`, iconos `lucide` (`components.json`). Alias: `@/components`, `@/components/ui`, `@/lib`, `@/hooks`.
  Los archivos de `components/ui/` se excluyen de Prettier para conservar el estilo de upstream.
- **Tipografía:** Geist Sans y Geist Mono vía `next/font/google` (`--font-geist-sans`, `--font-geist-mono`).
- **Tema:** `next-themes` (`attribute="class"`, `defaultTheme="light"`, `enableSystem`); el conmutador está en el menú de usuario.
- **i18n:** `next-intl` sin segmento `[locale]`; idioma desde `profiles.locale` → cookie `NEXT_LOCALE` → `es`. Diccionarios en `messages/{es,en}.json`.

## Lenguaje visual

| Elemento | Valor |
|---|---|
| Color primario | Emerald (`emerald-600/700`, `emerald-100`, `dark:emerald-900/30`; `#10B981` en gráficas) |
| Superficies | `bg-card`; fondo de contenido `bg-slate-50 dark:bg-slate-900` |
| Radios | `rounded-2xl` en tarjetas, `rounded-xl` en filas y navegación |
| Estados | Rojo: bajo stock, reembolso, eliminar. Naranja: advertencia. Púrpura/azul/naranja: KPIs secundarios |
| Idioma de la interfaz | **ES por defecto + EN** (`next-intl`, `profiles.locale`, sin `[locale]` en la URL; D12) |
| Dinero | `useMoney()` → `Intl.NumberFormat` con la moneda de **Ajustes** (defecto COP; decimales según `currencyDecimals`). El servidor devuelve números; nunca se formatea en el servidor |
| Nombre de la tienda | `settings.store_name` (sidebar), antes "POS System" fijo |

## Componentes compartidos

Además de `components/ui/*` (17 archivos; `tabs.tsx` sin uso):

| Componente | Para qué |
|---|---|
| `AppShell` | Navegación lateral/móvil **filtrada por rol**, menú de usuario (tema, idioma ES/EN, logout que vacía el carrito) |
| `ConfirmDialog` | Sustituye a `window.confirm()`: `AlertDialog` accesible que muestra progreso y no se cierra si falla |
| `TextField`, `SelectField` | Campos de `react-hook-form` con etiqueta y mensaje de error asociados (`htmlFor`/`aria-describedby` por `FormControl`) |
| `Pagination` (`lib/pagination.ts`, `hooks/use-pagination.ts`) | "Mostrando X–Y de N" + `Select` de tamaño (10/25/50, namespace `pagination` de next-intl) + primera/anterior/números/siguiente/última; **siempre visible** (ya no se oculta con una sola página); los números se ocultan en pantallas estrechas |
| `QueryError`, `PageSpinner` | Error con "Try again" y spinner (antes copiado en 5 archivos) |

## Layout del dashboard

`app/(dashboard)/layout.tsx` es un **Server Component** (sesión + ajustes) que monta `AppShell`, construido sobre el
`Sidebar` de shadcn (`components/ui/sidebar.tsx`, editado: breakpoint `lg` en vez de `md`, `SidebarInset` es un
`<div min-w-0>` en vez de un `<main>` sin acotar). Breakpoint único: **`lg` (1024 px)**, fijado en `hooks/use-mobile.ts`
(`MOBILE_BREAKPOINT`), único consumidor de `Sidebar`.

**Escritorio (≥ 1024 px):**
- **4 grupos colapsables** (`SidebarGroup` + `Collapsible`, abiertos por defecto): Ventas (Panel, Caja, Órdenes,
  Clientes), Catálogo (Productos, Categorías, Promociones, Inventario, Proveedores), Análisis (Reportes) y
  Administración (Ajustes, Usuarios, Auditoría). Un grupo sin ítems visibles para el rol actual se oculta entero.
- `SidebarHeader` (nombre de la tienda, `<span data-testid="store-name">`), `SidebarFooter` (`AccountMenu` variante
  `full`: avatar, nombre o email, rol) y `SidebarInset` con `TopBar` (`SidebarTrigger`, indicador de conexión,
  avatar) ([PWA y offline](09-pwa-offline.md)).
- Resalte de ruta activa por **prefijo** (`pathname === href || pathname.startsWith(href + '/')`): `/orders/[id]` sí
  resalta "Órdenes".
- El estado abierto/colapsado se guarda en la cookie `sidebar_state` (shadcn) y el layout la lee para fijar
  `defaultOpen` en el primer render, evitando el parpadeo al recargar.

**Móvil (< 1024 px), experiencia tipo app nativa** (`components/shell/`):
- **`TopBar`**: en las raíces muestra el nombre/inicial de la tienda; en rutas de detalle (`/orders/[id]`,
  `/customers/[id]`) un botón volver (`ChevronLeft`); siempre el título de la sección actual, el indicador de
  conexión y el avatar (`AccountMenu` variante `icon`).
- **`BottomNav`** (`nav[aria-label="Mobile navigation"]`, oculta en `lg+` y al imprimir): 5 destinos — Panel,
  Órdenes, **Caja** (centro, botón circular destacado), Inventario y **Más**. "Más" abre el `Sidebar` completo
  (mismo componente que en escritorio, como `Sheet`) con `setOpenMobile(true)`; navegar desde ahí lo cierra. El
  `Sidebar`, en móvil, **solo se monta mientras está abierto** (`data-mobile="true"` en el DOM solo entonces) — ojo
  con los selectores e2e.
- Safe areas: `env(safe-area-inset-top/bottom)` en `TopBar`, `BottomNav`, el FAB y las hojas inferiores; `app/layout.tsx`
  fija `viewportFit: 'cover'` (detalle en [PWA y offline](09-pwa-offline.md)).

## Patrones móviles (`< lg`)

| Componente | Comportamiento |
|---|---|
| `PageHeader` (`components/page-header.tsx`) | Título + descripción + `primaryAction`. En escritorio: `h1` grande y botón. En móvil: `h1` compacto (el título ya lo da `TopBar`) y `primaryAction` como **FAB** |
| `Fab` (`components/fab.tsx`) | Botón circular flotante sobre la `BottomNav` (`bottom-[calc(4rem+safe-area+1rem)]`), un único por pantalla, `lg:hidden` |
| `FilterBar` (`components/filter-bar.tsx`) | Buscador a ancho completo. En escritorio los filtros adicionales van en línea; en móvil se ocultan tras un botón **Filtros** (con contador) que abre un `Sheet side="bottom"` |
| `ResponsiveList` + `ListCardRow` (`components/responsive-list.tsx`) | Muestra la tabla existente en `md+` y una lista de tarjetas (`ListCardRow`: título, subtítulo, valor, `›` o `…`) por debajo; la tabla no se reescribe |
| `Dialog` (`components/ui/dialog.tsx`) | Por debajo de `sm`, se ancla como **hoja inferior** (`rounded-t-2xl`, `max-h-[90dvh]`); en `sm+` sigue centrado. Todos los formularios de alta/edición heredan esto sin tocarlos uno a uno |

Reglas táctiles: objetivos de al menos 44 px, `text-base` en inputs (evita el zoom de iOS, ya lo hace shadcn) y
`touch-manipulation` en la burbuja del carrito, la `BottomNav` y el FAB.

## Patrones de pantalla

1. **Listado:** cabecera (`h1` + descripción + botón "Add" solo si el rol puede escribir), buscador con *debounce*, tabla, paginación en servidor, estado vacío y de error.
2. **Alta/edición:** `Dialog` con `react-hook-form` + el **mismo esquema zod que valida el servidor**; los errores salen bajo cada campo (`Required`, `Must be 0 or more`…),
   los del servidor en un `toast`. El diálogo se monta al abrirse (`key` por producto), así que el formulario siempre parte del valor guardado.
3. **Detalle:** botón volver (`aria-label`), tarjetas de información, tabla.
4. **Confirmaciones destructivas:** `ConfirmDialog` (borrar producto/categoría, desactivar usuario); el reembolso pide **motivo** en un diálogo propio.
5. **Notificaciones:** `toast` de Sonner (`top-right`, `richColors`).
6. **Formularios de autenticación:** `method="post"` y botón deshabilitado hasta hidratar (ver [autenticación](03-autenticacion-y-sesion.md)).

## Impresión
El detalle de orden usa `window.print()`. Desde la Fase 5 (etapa 3) imprime un **ticket térmico no fiscal de 80 mm**
(`components/orders/receipt-ticket.tsx`, `hidden print:block`): la vista normal y el `AppShell` (sidebar/header) se
ocultan con `print:hidden` y `app/globals.css` fija `@page { size: 80mm auto; margin: 0 }`. Detalle en
[órdenes y reembolsos](../03-modulos/ordenes-y-reembolsos.md) y la decisión D21 (no es factura electrónica) en
[decisiones pendientes](../06-roadmap/decisiones-pendientes.md). El POS no llama a `window.print()`.

## Accesibilidad y responsive
- Etiquetas y errores de formulario asociados a su control por `FormControl`; los botones de solo icono llevan `aria-label` (cantidad +/−, quitar, editar, borrar, volver, página anterior/siguiente, alternar sidebar, menú de la cuenta).
- El catálogo del POS es navegable con teclado (`role="button"`, `Enter`/`Espacio`) y marca `aria-disabled` los productos sin stock.
- **[Verificado]** `e2e/responsive.e2e.ts` (proyecto `mobile` de Playwright, 375×812 con `hasTouch`/`isMobile`) comprueba que ninguna ruta principal tenga scroll horizontal, para los roles admin y cashier, a 375, 768 y 1280 px, además de la barra inferior, "Más", el FAB como hoja inferior, el avatar y una venta completa desde el POS en móvil. `bun run test:e2e` pasa (28/28, proyectos `chromium` y `mobile`) contra Supabase local.
- **[Por verificar]** No se ha probado con lectores de pantalla ni en dispositivos reales (solo Chromium headless); sin auditoría automatizada de accesibilidad (axe, Lighthouse).

## Reglas para UI nueva
- Reutilizar `components/ui/*` y los compartidos de arriba; no crear estilos ad hoc para tarjetas o botones.
- Dinero siempre con `useMoney()`; nunca `$${x.toFixed(2)}`.
- Botones de icono con `aria-label`; confirmaciones con `ConfirmDialog`, nunca `window.confirm()`.
- Los formularios reutilizan el esquema del servidor; la conversión de presentación (p. ej. porcentaje → fracción) vive en el esquema (`taxRatePercent`), no en el componente.
