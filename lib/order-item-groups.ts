/**
 * Groups expanded promotion order lines for ticket / order-detail UI.
 * Plain product lines stay as-is; lines that share a promotion_id become one group.
 */

export interface GroupableOrderItem {
    id: string
    promotion_id: string | null
    quantity: number
    unit_price: number
    discount: number
    tax: number
    total: number
    tax_rate: number | null
    product: { id: string; name: string; sku?: string }
    variant: { id: string; name: string } | null
    promotion: {
        id: string
        name: string
        /** Recipe units per package — used to derive packageQty (min line_qty / recipe_qty). */
        items?: Array<{ product_id: string; quantity: number }>
    } | null
}

export type OrderItemGroup =
    | { kind: 'product'; item: GroupableOrderItem }
    | {
          kind: 'promotion'
          promotionId: string
          name: string
          items: GroupableOrderItem[]
          /** Sum of component line totals (includes tax when callers put tax in total). */
          total: number
          /** Packages sold for this promo on the order/tab. */
          packageQty: number
      }

export function groupOrderItemsByPromotion(items: GroupableOrderItem[]): OrderItemGroup[] {
    const groups: OrderItemGroup[] = []
    const promoIndex = new Map<string, number>()

    for (const item of items) {
        if (!item.promotion_id) {
            groups.push({ kind: 'product', item })
            continue
        }
        const existing = promoIndex.get(item.promotion_id)
        if (existing !== undefined) {
            const group = groups[existing]
            if (group?.kind === 'promotion') {
                group.items.push(item)
                group.total += item.total
            }
            continue
        }
        promoIndex.set(item.promotion_id, groups.length)
        groups.push({
            kind: 'promotion',
            promotionId: item.promotion_id,
            name: item.promotion?.name ?? item.product.name,
            items: [item],
            total: item.total,
            packageQty: 1
        })
    }

    for (const group of groups) {
        if (group.kind !== 'promotion' || group.items.length === 0) continue
        group.packageQty = packagesFromLines(group.items)
    }

    return groups
}

/** Prefer recipe (min floor(line/recipe)); fall back to GCD of line qtys when recipe is missing. */
function packagesFromLines(lines: GroupableOrderItem[]): number {
    const recipe = lines[0]?.promotion?.items
    if (recipe && recipe.length > 0) {
        let min = Number.POSITIVE_INFINITY
        for (const r of recipe) {
            if (r.quantity <= 0) continue
            const line = lines.find(l => l.product.id === r.product_id)
            if (!line) return 1
            min = Math.min(min, Math.floor(line.quantity / r.quantity))
        }
        if (Number.isFinite(min) && min >= 1) return min
        return 1
    }
    const qtys = lines.map(i => i.quantity)
    const g = qtys.reduce((a, b) => gcd(a, b))
    return g >= 1 ? g : 1
}

function gcd(a: number, b: number): number {
    let x = Math.abs(a)
    let y = Math.abs(b)
    while (y) {
        const t = y
        y = x % y
        x = t
    }
    return x || 1
}
