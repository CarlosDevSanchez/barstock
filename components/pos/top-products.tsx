'use client'

import { useTranslations } from 'next-intl'
import { useMoney } from '@/components/session-provider'
import { productsApi } from '@/lib/api/products'
import { useApiQuery } from '@/hooks/use-api-query'
import { isSellable, type StockInfo } from '@/lib/stock'
import { QtyConfirmOverlay } from './qty-confirm-overlay'

interface TopProductsProps {
    /** Bump this after a sale completes to refresh the ranking. */
    reloadSignal: number
    pendingId: string | null
    pendingQty: number
    /** Units of a product still addable given the cart (presentations share their base's stock). */
    maxAddableFor: (product: StockInfo) => number
    onSelect: (productId: string) => void
    onChangeQty: (qty: number) => void
    onConfirm: () => void
}

/** Quick-sell strip: the store's 5 best sellers of the last 30 days (units sold, refunds excluded), computed in the
 * database. Hidden entirely once loaded if there is nothing to show yet (a brand new store). Same −/+/Confirm
 * pending flow as the catalog grid (pending id owned by the POS page). */
export function TopProducts({
    reloadSignal,
    pendingId,
    pendingQty,
    maxAddableFor,
    onSelect,
    onChangeQty,
    onConfirm
}: TopProductsProps) {
    const t = useTranslations('pos')
    const money = useMoney()
    const top = useApiQuery(signal => productsApi.top({ days: 30, limit: 5 }, signal), `top-products:${reloadSignal}`)

    if (!top.data || top.data.length === 0) return null

    return (
        <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">{t('topProducts')}</h2>
            <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 max-sm:mx-0 max-sm:px-0">
                {top.data.map(product => {
                    const stockInfo: StockInfo = { ...product, id: product.product_id }
                    const soldOut = !isSellable(stockInfo)
                    const maxQty = maxAddableFor(stockInfo)
                    const canAdd = !soldOut && maxQty > 0
                    const pending = pendingId === product.product_id
                    return (
                        <div
                            key={product.product_id}
                            role="button"
                            aria-disabled={!canAdd && !pending}
                            tabIndex={canAdd || pending ? 0 : -1}
                            onClick={() => {
                                if (pending || !canAdd) return
                                onSelect(product.product_id)
                            }}
                            onKeyDown={event => {
                                if (pending || !canAdd) return
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    onSelect(product.product_id)
                                }
                            }}
                            aria-label={t('addToCart', { name: product.name })}
                            className={`relative shrink-0 w-36 snap-start rounded-xl border p-2.5 text-left transition ${
                                canAdd || pending ? 'cursor-pointer hover:shadow-md' : 'opacity-50 cursor-not-allowed'
                            } ${pending ? 'ring-2 ring-emerald-500 shadow-md' : ''}`}
                        >
                            <p className="text-xs font-medium line-clamp-2 min-h-8">{product.name}</p>
                            <p className="text-sm font-bold text-emerald-600 truncate">
                                {money(product.selling_price)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                                {soldOut ? t('outOfStock') : t('unitsSold', { count: product.quantity })}
                            </p>

                            {pending && (
                                <QtyConfirmOverlay
                                    qty={pendingQty}
                                    maxQty={maxQty}
                                    onChangeQty={onChangeQty}
                                    onConfirm={onConfirm}
                                    className="rounded-xl gap-1.5 p-1.5"
                                />
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
