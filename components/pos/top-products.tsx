'use client'

import { useTranslations } from 'next-intl'
import { useMoney } from '@/components/session-provider'
import { productsApi } from '@/lib/api/products'
import { useApiQuery } from '@/hooks/use-api-query'

interface TopProductsProps {
    /** Bump this after a sale completes to refresh the ranking. */
    reloadSignal: number
    onAdd: (productId: string) => void
}

/** Quick-sell strip: the store's 5 best sellers of the last 30 days (units sold, refunds excluded), computed in the
 * database. Hidden entirely once loaded if there is nothing to show yet (a brand new store). */
export function TopProducts({ reloadSignal, onAdd }: TopProductsProps) {
    const t = useTranslations('pos')
    const money = useMoney()
    const top = useApiQuery(signal => productsApi.top({ days: 30, limit: 5 }, signal), `top-products:${reloadSignal}`)

    if (!top.data || top.data.length === 0) return null

    return (
        <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">{t('topProducts')}</h2>
            <div className="flex gap-2 overflow-x-auto pb-2">
                {top.data.map(product => {
                    const soldOut = product.stock === null || product.stock <= 0
                    return (
                        <button
                            key={product.product_id}
                            type="button"
                            disabled={soldOut}
                            onClick={() => onAdd(product.product_id)}
                            aria-label={t('addToCart', { name: product.name })}
                            className={`shrink-0 w-36 rounded-xl border p-2.5 text-left transition ${
                                soldOut ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:shadow-md'
                            }`}
                        >
                            <p className="text-xs font-medium line-clamp-2 min-h-8">{product.name}</p>
                            <p className="text-sm font-bold text-emerald-600 truncate">
                                {money(product.selling_price)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                                {soldOut ? t('outOfStock') : t('unitsSold', { count: product.quantity })}
                            </p>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
