# Glosario

## Dominio

| Término | Significado en este proyecto |
|---|---|
| **POS** | Point of Sale. La pantalla `/pos` donde un cajero arma un carrito y cobra. |
| **Orden (`orders`)** | Una venta. Tiene ítems (`order_items`) y pagos (`payments`). Estados: `draft`, `pending`, `completed`, `refunded`. |
| **Ítem de orden** | Una línea de venta: producto, variante opcional, cantidad, **precio con el que se vendió** (no cambia si luego cambia el producto), descuento, impuesto, total. |
| **SKU** | Código interno único del producto o variante (`UNIQUE NOT NULL`). |
| **Variante** | Variación de un producto (talla, color). Tiene su propio SKU y precio opcional. **No hay UI para crearlas ni el POS las vende** (D10); solo existen por el seed. |
| **Inventario (`inventory`)** | Stock por (producto, variante). Una fila por combinación. |
| **Transacción de inventario** | Registro de auditoría de un movimiento de stock (`sale`, `adjustment`, `return`; `purchase` aún sin usar). Solo lo escriben los RPC. |
| **Umbral de stock bajo** | `inventory.low_stock_threshold`, **por artículo**. Por defecto el de Ajustes (10). Un artículo está en stock bajo si `quantity <= umbral`. |
| **Reembolso** | RPC `refund_order`: marca la orden `refunded` con motivo, repone el stock de cada línea y registra el movimiento. Total, idempotente, solo gerente/admin. |
| **Orden de compra (PO)** | Pedido a un proveedor (`purchase_orders`). Existe el esquema; **no hay UI**. |
| **Cajero / Gerente / Admin** | Roles jerárquicos en `profiles.role` (`cashier` < `manager` < `admin`). Restringen la API, la navegación y la base de datos. Ver [RLS](02-base-de-datos/03-rls-y-politicas.md). |
| **Cliente de mostrador (walk-in)** | Venta sin `customer_id`. |
| **Usuario activo / desactivado** | `profiles.is_active`. Un usuario desactivado no pasa ninguna política ni puede iniciar sesión. Se desactiva en lugar de borrar. |
| **Invitación** | Única forma de crear usuarios: un admin invita por correo y el rol se asigna en el servidor. Ver [autenticación](01-arquitectura/03-autenticacion-y-sesion.md). |
| **Borrado lógico** | `products.deleted_at` / `promotions.deleted_at`: desaparece del catálogo pero el historial de ventas lo conserva. |
| **Promoción / paquete** | Catálogo `promotions` + `promotion_items`: varios productos a `package_price` fijo. Admin en `/promotions`; venta vía expansión en `create_sale` / `tab_add_items` (precio asignado). |
| **Precio asignado** | `unit_price` escrito en `order_items` al vender un combo: reparto de `package_price`, **no** el `selling_price` de lista. Es la fuente de verdad del ingreso cobrado. |
| **Markdown de promo** | Diferencia lista − base asignada en líneas con `promotion_id` (`promo_markdown` en `sales_report`). No es el descuento global de la orden. |
| **COGS / utilidad bruta** | Costo de lo vendido ≈ `qty × cost_price` actual; utilidad bruta = bases cobradas − COGS (en `/reports`, gerente+). Sin foto de costo en la venta (v1). |

## Técnico

| Término | Significado |
|---|---|
| **RLS** | Row Level Security de PostgreSQL. Segunda capa de autorización, independiente de la comprobación de rol de `route()`. Un `UPDATE`/`DELETE` que no cumple **afecta 0 filas sin error**. |
| **PostgREST** | API REST que Supabase genera sobre Postgres; `supabase-js` habla con ella. |
| **anon key** | Clave pública de Supabase incluida en el bundle del navegador (`NEXT_PUBLIC_SUPABASE_ANON_KEY`). Por diseño no es secreta; la seguridad depende de RLS. |
| **`service_role`** | Clave de Supabase que **salta RLS**. Solo la usa `lib/server/supabase-admin.ts` para invitar usuarios; **nunca** debe exponerse al cliente ni ir en `NEXT_PUBLIC_*`. |
| **RPC** | Función Postgres invocada con `supabase.rpc('nombre', args)`. Aquí son la **única** vía para escribir ventas y stock: `create_sale`, `refund_order`, `adjust_inventory`. |
| **`SECURITY DEFINER`** | Función que corre con los permisos de su dueño (salta RLS). Los RPC de escritura y los triggers la usan y **fijan `search_path = ''`**; los de reportes son `SECURITY INVOKER`. |
| **Client Component** | Componente con `"use client"`. Las páginas lo son; el layout del dashboard es un Server Component. Ver [arquitectura](01-arquitectura/01-vision-general.md). |
| **Zustand store** | Estado global en el cliente: solo `cart` (ids y cantidades). |
| **`route()`** | Envoltorio de los Route Handlers: origen, sesión y rol, validación zod y formato de errores. Ver [API](01-arquitectura/08-api.md). |
| **Proxy (`proxy.ts`)** | Antes `middleware`: refresca la sesión y guarda rutas y roles (guarda de UX, no la frontera de seguridad). |
| **Mailpit** | Buzón local de Supabase (`http://127.0.0.1:54324`) donde llegan los correos de invitación y recuperación. |
| **shadcn/ui** | Componentes copiados en `components/ui/` sobre Radix + Tailwind (estilo `new-york`). |
