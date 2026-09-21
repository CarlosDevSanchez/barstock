# H2 — Cero validación de entrada

| | |
|---|---|
| **Severidad** | Alto |
| **Área** | Seguridad / calidad de datos |
| **Esfuerzo** | Medio |
| **Estado** | Corregido (esquemas zod compartidos cliente/servidor + `CHECK`/`NOT NULL` en la BD). Pendiente de **Verificado**: pruebas del Paso 6 |
| **Confianza** | **[Verificado]** |

## Hallazgo

- `zod`, `react-hook-form` y `@hookform/resolvers` están en `package.json` y **no se importan en ningún archivo** de `app/`, `lib/` ni `stores/` (búsqueda por `from 'zod'`, `react-hook-form`, `zodResolver`).
- Todos los formularios usan `useState` + atributos HTML (`required`, `type`). Ejemplos:
  - Productos: `parseFloat(formData.cost_price)` sin comprobar `NaN`, sin rangos (`products/page.tsx:57-62`).
  - POS: descuento con `Number(e.target.value)`; `min="0"` es solo HTML (`pos/page.tsx:333-340`).
  - Registro: solo longitud mínima 6 (`register/page.tsx:32`).
  - Clientes/Proveedores: sin validación de teléfono ni formato.
- No hay validación **en el servidor** (no hay servidor propio) ni `CHECK` en la BD ([índices y constraints](../../02-base-de-datos/05-indices-y-constraints.md)).
- Cadenas vacías enviadas como valores (`barcode: ''`, `category_id: ''`, `email: ''`): ver [M14](medios-y-bajos.md).
- `components/ui/form.tsx` (wrapper de react-hook-form) existe sin uso.

## Impacto

Datos inválidos en la base (precios negativos, `NaN`, descuentos mayores al subtotal, cantidades 0), errores
crudos de Postgres mostrados al usuario, y cero defensa frente a peticiones manipuladas.

## Recomendación

1. Crear `lib/validation/` con esquemas zod por entidad (`productSchema`, `customerSchema`, `saleInputSchema`, `settingsSchema`, `credentialsSchema`).
2. Usar `react-hook-form` + `zodResolver` con `components/ui/form.tsx` en los diálogos de alta/edición.
3. Normalizar: `''` → `null`, `trim()`, números con `z.coerce.number()`, dinero como enteros de centavos o `string` decimal.
4. **Reforzar en la BD**: `CHECK`, `NOT NULL`, enums; los esquemas de RPC deben validar de nuevo (el cliente no es de fiar).
5. Política de contraseña en Supabase Auth (longitud ≥ 10–12) y mensajes de error controlados (no exponer `error.message` crudo).

## Criterios de aceptación

- [ ] Ningún formulario envía datos sin pasar por un esquema zod.
- [ ] Valores negativos, `NaN` y descuentos > subtotal son rechazados con mensaje claro.
- [ ] Los campos opcionales vacíos se guardan como `NULL`.
- [ ] Las RPC validan sus entradas y la BD tiene `CHECK` equivalentes.
- [ ] Tests unitarios de los esquemas.
