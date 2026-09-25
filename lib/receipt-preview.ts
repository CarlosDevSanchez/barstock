import type { CartLineView } from '@/components/pos/cart-sheet'
import type { OrderDetail } from '@/lib/api/orders'
import type { PaymentMethod } from '@/types'
import type { PreviewTotals } from './cart-preview'
import { allocatePackagePrice } from './promotion-allocate'

/** Half-up rounding to `decimals`, same rule `previewTotals`/`create_sale` use for a line's tax. */
function lineTax(base: number, taxRate: number, decimals: number): number {
    const unit = 10 ** decimals
    const baseUnits = Math.round(base * unit)
    const rateBasisPoints = Math.round(taxRate * 10_000)
    return Math.floor((baseUnits * rateBasisPoints + 5_000) / 10_000) / unit
}

export interface ProvisionalOrderInput {
    provisionalNumber: string
    /** Device clock at checkout (what gets sent as `occurred_at` once this syncs). */
    occurredAt: string
    customerName: string | null
    paymentMethod: PaymentMethod
    cashierName: string
    lines: CartLineView[]
    totals: PreviewTotals
    decimals: number
}

/**
 * Builds an `OrderDetail`-shaped object good enough to print (F4, docs/06-roadmap/offline-y-sincronizacion.md),
 * for a sale that has only been queued, not synced yet — there is no real order to fetch. Mirrors the same math
 * the cart preview already shows the cashier (`allocatePackagePrice`, the per-line tax rule `previewTotals` uses);
 * `create_sale` always recomputes for real once this syncs, and can differ (see `orders.sync_issues`). Every id
 * here is a throwaway UUID: nothing in this object is ever sent to the server or navigated to.
 */
export function buildProvisionalOrder(input: ProvisionalOrderInput): OrderDetail {
    const items: OrderDetail['items'] = []

    for (const line of input.lines) {
        if (line.kind === 'product') {
            if (!line.product) continue
            const unitPrice = line.product.selling_price
            const discount = line.item.discount
            const base = Math.max(unitPrice * line.item.quantity - discount, 0)
            const tax = lineTax(base, line.product.tax_rate, input.decimals)
            items.push({
                id: crypto.randomUUID(),
                order_id: '',
                created_at: input.occurredAt,
                product_id: line.product.id,
                variant_id: null,
                promotion_id: null,
                stock_taken: null,
                unit_cost: null,
                quantity: line.item.quantity,
                unit_price: unitPrice,
                discount,
                tax,
                total: base + tax,
                tax_rate: line.product.tax_rate,
                product: { id: line.product.id, name: line.product.name, sku: line.product.sku },
                variant: null,
                promotion: null
            })
            continue
        }

        if (!line.promotion) continue
        const components = line.promotion.items
            .filter(component => component.product)
            .map(component => ({
                productId: component.product_id,
                quantity: component.quantity,
                sellingPrice: component.product!.selling_price,
                taxRate: component.product!.tax_rate
            }))
        const allocated = allocatePackagePrice(
            line.promotion.package_price,
            line.item.quantity,
            components,
            input.decimals
        )
        for (const alloc of allocated) {
            const component = line.promotion.items.find(c => c.product_id === alloc.productId)
            if (!component?.product) continue
            const base = Math.max(alloc.unitPrice * alloc.quantity - alloc.discount, 0)
            const tax = lineTax(base, alloc.taxRate, input.decimals)
            items.push({
                id: crypto.randomUUID(),
                order_id: '',
                created_at: input.occurredAt,
                product_id: alloc.productId,
                variant_id: null,
                promotion_id: line.promotion.id,
                stock_taken: null,
                unit_cost: null,
                quantity: alloc.quantity,
                unit_price: alloc.unitPrice,
                discount: alloc.discount,
                tax,
                total: base + tax,
                tax_rate: alloc.taxRate,
                product: { id: component.product.id, name: component.product.name, sku: '' },
                variant: null,
                promotion: { id: line.promotion.id, name: line.promotion.name }
            })
        }
    }

    return {
        id: crypto.randomUUID(),
        order_number: input.provisionalNumber,
        customer_id: null,
        debtor_name: null,
        status: 'completed',
        subtotal: input.totals.subtotal,
        discount: input.totals.discount,
        tax: input.totals.tax,
        total: input.totals.total,
        notes: null,
        created_by: null,
        business_day_id: null,
        cash_session_id: null,
        refund_cash_session_id: null,
        refund_after_close: false,
        created_at: input.occurredAt,
        updated_at: input.occurredAt,
        refunded_at: null,
        refunded_by: null,
        refund_reason: null,
        tab_id: null,
        client_ref: null,
        occurred_at: input.occurredAt,
        source: 'offline',
        sync_issues: null,
        reviewed_by: null,
        reviewed_at: null,
        settled_at: input.occurredAt,
        due_date: null,
        reminder_enabled: false,
        reminder_note: null,
        written_off_at: null,
        written_off_by: null,
        write_off_reason: null,
        customer: input.customerName ? { id: '', name: input.customerName, email: null, phone: null } : null,
        items,
        payments: [
            {
                id: crypto.randomUUID(),
                order_id: '',
                created_at: input.occurredAt,
                payment_method: input.paymentMethod,
                amount: input.totals.total,
                reference_number: null,
                notes: null,
                created_by: null,
                business_day_id: null,
                cash_session_id: null
            }
        ],
        created_by_name: input.cashierName,
        tab: null
    }
}
