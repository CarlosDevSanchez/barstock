# Glosario

## Dominio

| Término | Significado en este proyecto |
|---|---|
| **POS** | Point of Sale. La pantalla `/pos` donde un cajero arma un carrito y cobra. |
| **Orden (`orders`)** | Una venta. Tiene ítems (`order_items`) y pagos (`payments`). Estados: `draft`, `pending`, `completed`, `refunded`. |
| **Ítem de orden** | Una línea de venta: producto, variante opcional, cantidad, precio unitario, descuento, impuesto, total. |
| **SKU** | Código interno único del producto o variante (`UNIQUE NOT NULL`). |
| **Variante** | Variación de un producto (talla, color). Tiene su propio SKU y precio opcional. **No hay UI para crearlas**; solo existen por el seed. |
| **Inventario (`inventory`)** | Stock por (producto, variante). Una fila por combinación. |
| **Transacción de inventario** | Registro de auditoría de un movimiento de stock (`sale`, `purchase`, `adjustment`, `return`). |
| **Umbral de stock bajo** | `inventory.low_stock_threshold`. Por defecto 10. |
| **Reembolso** | Cambio de estado de una orden a `refunded` más reposición de stock. |
| **Orden de compra (PO)** | Pedido a un proveedor (`purchase_orders`). Existe el esquema; **no hay UI**. |
| **Cajero / Gerente / Admin** | Roles en `profiles.role` (`cashier`, `manager`, `admin`). Hoy son **nominales**: no restringen nada. Ver [RLS](02-base-de-datos/03-rls-y-politicas.md). |
| **Cliente de mostrador (walk-in)** | Venta sin `customer_id`. |

## Técnico

| Término | Significado |
|---|---|
| **RLS** | Row Level Security de PostgreSQL. Es el **único control de acceso del lado servidor** en este proyecto. |
| **PostgREST** | API REST que Supabase genera sobre Postgres; `supabase-js` habla con ella. |
| **anon key** | Clave pública de Supabase incluida en el bundle del navegador (`NEXT_PUBLIC_SUPABASE_ANON_KEY`). Por diseño no es secreta; la seguridad depende de RLS. |
| **`service_role`** | Clave de Supabase que **salta RLS**. No se usa en este proyecto y **nunca** debe exponerse al cliente. |
| **RPC** | Función Postgres invocada con `supabase.rpc('nombre', args)`. Es la vía recomendada para el checkout transaccional. |
| **`SECURITY DEFINER`** | Función que corre con los permisos de su dueño. Usada en `handle_new_user`. |
| **Client Component** | Componente con `"use client"`. 15 de las 16 páginas y el layout del dashboard lo son (solo `/` es Server Component); ver [arquitectura](01-arquitectura/01-vision-general.md). |
| **Zustand store** | Estado global en el cliente: `auth`, `cart`, `settings`. |
| **shadcn/ui** | Componentes copiados en `components/ui/` sobre Radix + Tailwind (estilo `new-york`). |
