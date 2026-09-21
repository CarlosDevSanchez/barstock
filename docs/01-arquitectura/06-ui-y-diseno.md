# UI y sistema de diseño

> Base: commit `54962b9` · Confianza: **[Verificado]**

## Tecnología

- **Tailwind CSS 4** (sin `tailwind.config`): `app/globals.css` importa `tailwindcss` y `tw-animate-css`,
  define `@custom-variant dark (&:is(.dark *))` y expone los tokens con `@theme inline`
  (`--color-background`, `--color-primary`, `--radius-*`, `--color-sidebar-*`, `--color-chart-1..5`).
- **shadcn/ui**, estilo `new-york`, `baseColor: neutral`, `cssVariables: true`, `rsc: true`, iconos
  `lucide` (`components.json`). Alias: `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils`, `@/hooks`
  (la carpeta `hooks/` no existe).
- **Tipografía:** Geist Sans y Geist Mono vía `next/font/google` (`app/layout.tsx`), expuestas como
  `--font-geist-sans` y `--font-geist-mono`.
- **Tema:** `next-themes` con `attribute="class"`, `defaultTheme="light"`, `enableSystem`,
  `disableTransitionOnChange`. El conmutador está en el menú de usuario del layout
  (`layout.tsx:133-136`). `suppressHydrationWarning` en `<html>`.

## Lenguaje visual

| Elemento | Valor observado |
|---|---|
| Color primario | Emerald (`#10B981` en gráficas; clases `emerald-600/700`, `emerald-100`, `dark:emerald-900/30`) |
| Superficies | `bg-card`, fondo de contenido `bg-slate-50 dark:bg-slate-900` (`layout.tsx:216`) |
| Radios | `rounded-2xl` en tarjetas, `rounded-xl` en filas y botones de navegación |
| Estados | Rojo para bajo stock/reembolso/eliminar; naranja para advertencia; púrpura/azul/naranja para KPIs secundarios |
| Idioma de la interfaz | **Inglés** (etiquetas, toasts, placeholders). La documentación está en español. |
| Moneda | Símbolo `$` fijo en JSX (`${x.toFixed(2)}`), sin `Intl.NumberFormat` ni relación con el ajuste de moneda |

## Componentes `components/ui/`

16 archivos. Uso real (importaciones desde `app/` y `components/`):

| Componente | Archivos que lo usan |
|---|---|
| `card` | 15 |
| `button` | 14 |
| `input` | 11 |
| `badge`, `label`, `table` | 9 c/u |
| `dialog` | 5 |
| `select` | 4 |
| `separator` | 2 |
| `avatar`, `dropdown-menu`, `scroll-area`, `sheet`, `sonner` | 1 c/u |
| `form`, `tabs` | **0** |

## Layout del dashboard

`app/(dashboard)/layout.tsx`:

- **Escritorio (`lg+`):** sidebar fijo de `w-64` con logo "POS System", 10 enlaces y menú de usuario
  (Avatar con inicial + rol, Perfil, cambiar tema, Logout). "Profile" es un ítem **sin acción**.
- **Móvil:** cabecera con `Sheet` lateral (mismos enlaces) y menú de usuario.
- **Resalte de ruta activa:** `pathname === item.href` (igualdad exacta). Rutas hijas como
  `/orders/[id]` **no** resaltan "Orders".
- El nombre "POS System" está hardcodeado; `APP_NAME` en `lib/constants.ts` no se usa.

## Patrones de pantalla repetidos

1. **Listado:** cabecera (`h1` + descripción + botón "Add"), tarjetas KPI, tarjeta con buscador y `Table`.
2. **Alta/edición:** `Dialog` con `useState` de un objeto `formData` y `handleSubmit` que hace insert o update.
3. **Detalle:** botón volver (`ArrowLeft`), tarjetas de información, tabla de ítems.
4. **Carga:** spinner esmeralda a pantalla completa (5 copias).
5. **Notificaciones:** `toast.success/error` de Sonner, posición `top-right`, `richColors`.
6. **Confirmaciones destructivas:** `window.confirm()` (borrar producto, borrar categoría, reembolsar,
   imprimir recibo). Debería ser `AlertDialog`.

## Impresión

`window.print()` en `/pos` (tras el cobro) y en `/orders/[id]`. En detalle de orden se usan utilidades
`print:hidden` / `print:space-y-4` para ocultar controles. **No hay plantilla de recibo**; se imprime la
página. En `/pos`, `window.print()` se ejecuta **después de `clearCart()`** (`pos/page.tsx:168-175`), por lo
que **[Inferido]** imprime la pantalla del POS con el carrito ya vaciado, no un recibo con lo vendido. `receipt_template` existe en el seed pero nadie lo lee.

## Accesibilidad y responsive

- **[Verificado]** Hay 36 usos de `<Label>` en `app/` y solo 18 `htmlFor`, concentrados en login,
  registro, recuperar contraseña, productos y categorías. El POS, ajustes, clientes y proveedores tienen
  etiquetas sin asociar a su control.
- **[Verificado]** 0 usos de `aria-label` en `app/`. Hay botones de solo icono (`size="icon"`, 7 en
  `app/`) sin nombre accesible: cantidad +/− y borrar en el POS, volver en los detalles.
- **[Inferido]** Diseño responsive con `grid`/`flex` y breakpoints `sm/md/lg`; el POS colapsa a una
  columna. No se probó en dispositivos.
- Sin pruebas visuales ni de accesibilidad automatizadas.

## Reglas para UI nueva

- Reutilizar `components/ui/*`; no crear estilos ad hoc para tarjetas/botones.
- Extraer `LoadingSpinner`, `PageHeader`, `ConfirmDialog` antes de copiar por sexta vez.
- Formatear dinero con `Intl.NumberFormat` usando la moneda de ajustes.
- Añadir `aria-label` a botones de icono.
