'use client'

import { Package } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useMoney } from '@/components/session-provider'
import type { PromotionListItem } from '@/lib/api/promotions'
import { QtyConfirmOverlay, maxAddable } from './qty-confirm-overlay'

interface PromotionCardProps {
    promotion: PromotionListItem
    pending: boolean
    /** Packages to add (parent-owned draft). Always starts at 1 — never the recipe item count. */
    qty: number
    qtyInCart: number
    onSelect: () => void
    onChangeQty: (qty: number) => void
    onConfirm: () => void
}

/** One-line recipe summary: "1× Beer · 1× Snack" (package size, not sell quantity). */
export function formatPromoRecipe(promotion: PromotionListItem): string {
    return promotion.items.map(item => `${item.quantity}× ${item.product?.name ?? '—'}`).join(' · ')
}

/** Compact POS tile for a fixed-price package. Same −/+/Confirm UX as ProductCard, counting packages. */
export function PromotionCard({
    promotion,
    pending,
    qty,
    qtyInCart,
    onSelect,
    onChangeQty,
    onConfirm
}: PromotionCardProps) {
    const t = useTranslations('pos')
    const money = useMoney()
    const maxQty = maxAddable(promotion.available, qtyInCart)
    const soldOut = promotion.available === null || promotion.available <= 0
    const canAdd = !soldOut && maxQty > 0
    const recipe = formatPromoRecipe(promotion)
    const stockDetail =
        promotion.available === null ? recipe : t('promoStockDetail', { recipe, count: promotion.available })
    const recipeWithStock = promotion.items
        .map(item => {
            const stock =
                item.product?.stock === null || item.product?.stock === undefined ? '—' : String(item.product.stock)
            return `${item.quantity}× ${item.product?.name ?? '—'} (stock ${stock})`
        })
        .join(' · ')

    return (
        <Card
            role="button"
            aria-disabled={!canAdd && !pending}
            aria-label={t('addPromoToCart', { name: promotion.name })}
            title={recipeWithStock}
            tabIndex={canAdd || pending ? 0 : -1}
            className={`relative min-w-0 transition-all rounded-xl overflow-hidden group py-0 gap-0 ${
                canAdd || pending ? 'cursor-pointer hover:shadow-lg' : 'opacity-50 cursor-not-allowed'
            } ${pending ? 'ring-2 ring-emerald-500 shadow-lg' : ''}`}
            onClick={() => {
                if (pending || !canAdd) return
                onSelect()
            }}
            onKeyDown={event => {
                if (pending || !canAdd) return
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect()
                }
            }}
        >
            <div className="aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-amber-50 to-slate-50 dark:from-amber-950/20 dark:to-slate-900 flex items-center justify-center shrink-0">
                <Package className="w-6 h-6 text-amber-600/40 group-hover:text-amber-600/60 transition-colors" />
            </div>
            <CardContent className="p-2.5 min-w-0 flex flex-col gap-1">
                <h3 className="text-xs font-medium line-clamp-2 min-h-8">{promotion.name}</h3>
                <p className="text-sm font-bold text-emerald-600 truncate">{money(promotion.package_price)}</p>
                {recipe && (
                    <p className="text-[10px] text-muted-foreground line-clamp-1" title={recipeWithStock}>
                        {t('promoRecipe', { recipe })}
                    </p>
                )}
                <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px]">
                        {t('promoBadge')}
                    </Badge>
                    <Badge
                        variant={soldOut ? 'destructive' : 'secondary'}
                        className="text-[10px]"
                        title={stockDetail}
                        aria-label={soldOut ? t('outOfStock') : t('packagesLeft', { count: promotion.available ?? 0 })}
                    >
                        {soldOut ? t('outOfStock') : t('packagesLeft', { count: promotion.available ?? 0 })}
                    </Badge>
                </div>
            </CardContent>
            {pending && (
                <QtyConfirmOverlay
                    qty={qty}
                    maxQty={maxQty}
                    unit="packages"
                    onChangeQty={onChangeQty}
                    onConfirm={onConfirm}
                />
            )}
        </Card>
    )
}
