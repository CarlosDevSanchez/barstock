# Decisiones pendientes (producto y negocio)

> Preguntas que **bloquean o condicionan** decisiones técnicas. Cada una debe resolverse con quien defina el negocio y, al
> cerrarse, registrarse aquí con fecha y responsable (formato ADR ligero). Nada de esto se asume en el código actual.
> Base: commit `54962b9`.

## Tabla resumen

| ID | Decisión | Bloquea | Recomendación técnica | Estado |
|---|---|---|---|---|
| D1 | ¿Registro público, por invitación o solo admin crea usuarios? | [C1](../04-auditoria/hallazgos/C1-rls-permisivo.md) | Solo admin crea/invita usuarios | Pendiente |
| D2 | ¿Un solo negocio, o varias sucursales/tiendas? | Esquema (`store_id`), RLS | Si hay riesgo de multi-sucursal, añadir `store_id` **antes** de más datos | Pendiente |
| D3 | Regla fiscal: ¿tasa por producto o global? ¿precio con o sin impuesto? ¿redondeo por línea o por total? ¿descuento antes o después del impuesto? | [H3](../04-auditoria/hallazgos/H3-impuestos-y-dinero.md), `create_sale` | Tasa por producto, precios sin impuesto, redondeo por línea, descuento antes del impuesto — **validar con contabilidad** | Pendiente |
| D4 | Moneda: ¿única o varias? ¿formato regional? | UI, `settings` | Una moneda por instalación, configurable; `Intl.NumberFormat` | Pendiente |
| D5 | Pagos: ¿mixtos (efectivo+tarjeta)? ¿vuelto? ¿propinas? ¿integración con terminal? | `payments`, UI de cobro | Permitir varios pagos por orden (el esquema ya lo permite) y calcular vuelto | Pendiente |
| D6 | Descuentos: ¿topes por rol? ¿motivo obligatorio? ¿aprobación de gerente? | `create_sale`, RLS | Tope por rol y motivo sobre cierto monto, auditado | Pendiente |
| D7 | Fidelidad: ¿cómo se acumulan y canjean los puntos? ¿los reembolsos los restan? | [clientes](../03-modulos/clientes.md) | Derivar de las órdenes (trigger/vista), no editar a mano | Pendiente |
| D8 | Reembolsos: ¿parciales? ¿ventana de tiempo? ¿quién autoriza? ¿devuelve al stock siempre? | `refund_order` | Solo gerente/admin, con motivo; parcial por ítem como evolución | Pendiente |
| D9 | Stock: ¿se permite vender sin stock o sin fila de inventario? ¿stock negativo? | `create_sale`, `CHECK` | No permitir negativo; productos sin control de stock marcados explícitamente | Pendiente |
| D10 | Variantes: ¿se venden desde el POS? ¿qué atributos? | UI del POS, inventario | Si sí: selector de variante y alta en productos | Pendiente |
| D11 | Ajustes: ¿en BD (`settings`), en cliente, o ambos? | [ajustes](../03-modulos/ajustes.md) | **Solo BD** (tabla `settings`) con RLS solo-admin | Pendiente |
| D12 | Idioma de la interfaz | UI | Definir si se traduce (i18n) o se queda en inglés | Pendiente |
| D13 | Entornos y despliegue: ¿Vercel + un Supabase por entorno? ¿quién despliega? | CI/CD, variables | dev / staging / prod separados; despliegue por PR | Pendiente |
| D14 | Datos personales de clientes: retención, borrado, consentimiento, normativa aplicable | Clientes, RLS, backups | Minimizar campos; política de retención; acceso por rol | Pendiente |
| D15 | Hardware: lector de códigos, impresora térmica, cajón de dinero | POS, recibo | Lector como teclado (auto-agregar con Enter); impresión ESC/POS o recibo HTML | Pendiente |
| D16 | ¿Se necesita operar **sin conexión**? | Arquitectura del POS | Hoy es imposible (todo va a Supabase). Si sí, requiere cola offline y sincronización — cambio grande | Pendiente |
| D17 | Roles: ¿bastan admin/gerente/cajero? ¿permisos finos? | RLS | Empezar con 3 roles; tabla de permisos si crece | Pendiente |
| D18 | Backups: RPO/RTO aceptables; quién restaura | [migraciones](../02-base-de-datos/06-seed-y-migraciones.md) | PITR si el negocio no tolera perder ventas | Pendiente |
| D19 | Política de rotación de claves y accesos | [variables de entorno](../05-guias/variables-de-entorno.md) | Rotación tras salida de personal y ante sospecha | Pendiente |
| D20 | Licencia del proyecto (el README declara MIT; no hay `LICENSE`) | Legal | Definir con el cliente/propietario; añadir `LICENSE` acorde | Pendiente |

## Detalle de las decisiones de mayor impacto

### D3 — Regla fiscal
Impacta el cálculo de `create_sale`, el tipo de `tax_rate`, los reportes y la contabilidad. Hoy coexisten dos criterios
([H3](../04-auditoria/hallazgos/H3-impuestos-y-dinero.md)). Preguntas concretas para contabilidad:
1. ¿Los precios que ve el cliente incluyen impuesto?
2. ¿Hay productos exentos o con tasa reducida?
3. ¿Se aplica el descuento antes o después del impuesto?
4. ¿Cuál es la regla de redondeo aceptada por la autoridad fiscal?
5. ¿Se requiere factura/comprobante fiscal con formato específico?

### D2 — Multi-sucursal
Añadir `store_id` después es costoso (migración de datos, RLS, reportes). Si existe una posibilidad razonable de más de un local, decidirlo antes de la Fase 1.

### D9 — Stock
Determina si una venta sin fila de `inventory` falla o se permite, y si existe "producto sin control de inventario" (servicios, bebidas
preparadas). Impacta la UX del POS.

## Cómo registrar una decisión

Sustituir `Pendiente` por `Decidido (AAAA-MM-DD, responsable)` y añadir bajo la tabla:

```
### D3 — Decidido 2026-xx-xx (nombre/rol)
Decisión: …
Motivo: …
Alternativas descartadas: …
Impacto en el código/BD: … (enlaces a PR y migración)
```
