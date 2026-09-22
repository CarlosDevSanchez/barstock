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

`app/(dashboard)/layout.tsx` es un **Server Component** (sesión + ajustes) que monta `AppShell`:

- **Escritorio (`lg+`):** sidebar de `w-64` con el nombre de la tienda, los enlaces permitidos al rol y el menú de usuario (inicial, nombre o email, rol).
- **Móvil:** cabecera con `Sheet` lateral (mismos enlaces) y menú de usuario.
- Resalte de ruta activa por **igualdad exacta** (`pathname === href`): `/orders/[id]` no resalta "Orders" (pendiente menor).
- El markup de navegación sigue duplicado entre escritorio y móvil (candidato a `<SidebarNav>`).

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
- Etiquetas y errores de formulario asociados a su control por `FormControl`; los botones de solo icono llevan `aria-label` (cantidad +/−, quitar, editar, borrar, volver, página anterior/siguiente).
- El catálogo del POS es navegable con teclado (`role="button"`, `Enter`/`Espacio`) y marca `aria-disabled` los productos sin stock.
- **[Inferido]** Diseño responsive con `grid`/`flex` y breakpoints `sm/md/lg`; el POS colapsa a una columna. No se ha probado en dispositivos ni con lectores de pantalla.
- Sin auditoría automatizada de accesibilidad ni pruebas visuales.

## Reglas para UI nueva
- Reutilizar `components/ui/*` y los compartidos de arriba; no crear estilos ad hoc para tarjetas o botones.
- Dinero siempre con `useMoney()`; nunca `$${x.toFixed(2)}`.
- Botones de icono con `aria-label`; confirmaciones con `ConfirmDialog`, nunca `window.confirm()`.
- Los formularios reutilizan el esquema del servidor; la conversión de presentación (p. ej. porcentaje → fracción) vive en el esquema (`taxRatePercent`), no en el componente.
