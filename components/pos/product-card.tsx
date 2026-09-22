'use client'

import { ShoppingCart } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useMoney } from '@/components/session-provider'
import type { ProductListItem } from '@/lib/api/products'

interface ProductCardProps {
    product: ProductListItem
    onAdd: (productId: string) => void
}

/**
 * Compact tile for the POS grid. The image strip, name, price and badge row each sit on their own line so a long
 * name or a long category never pushes the price out of view or breaks the card's layout (`min-w-0` + `flex-wrap`).
 */
export function ProductCard({ product, onAdd }: ProductCardProps) {
    const t = useTranslations('pos')
    const money = useMoney()
    // stock null = no inventory row, which the database refuses to sell.
    const soldOut = product.stock === null || product.stock <= 0

    return (
        <Card
            role="button"
            aria-disabled={soldOut}
            aria-label={t('addToCart', { name: product.name })}
            title={t('sku', { sku: product.sku })}
            tabIndex={soldOut ? -1 : 0}
            className={`min-w-0 transition-all rounded-xl overflow-hidden group py-0 gap-0 ${
                soldOut ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:shadow-lg'
            }`}
            onClick={() => !soldOut && onAdd(product.id)}
            onKeyDown={event => {
                if (!soldOut && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    onAdd(product.id)
                }
            }}
        >
            <div className="h-14 bg-gradient-to-br from-emerald-50 to-slate-50 dark:from-emerald-950/20 dark:to-slate-900 flex items-center justify-center shrink-0">
                {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- untrusted, arbitrary-sized product images
                    <img src={product.image_url} alt="" className="h-full w-full object-cover" />
                ) : (
                    <ShoppingCart className="w-6 h-6 text-emerald-600/30 group-hover:text-emerald-600/50 transition-colors" />
                )}
            </div>
            <CardContent className="p-2.5 min-w-0 flex flex-col gap-1">
                <h3 className="text-xs font-medium line-clamp-2 min-h-8">{product.name}</h3>
                <p className="text-sm font-bold text-emerald-600 truncate">{money(product.selling_price)}</p>
                <div className="flex flex-wrap gap-1">
                    <Badge
                        variant={soldOut ? 'destructive' : 'secondary'}
                        className="text-[10px] max-w-full truncate whitespace-nowrap"
                        aria-label={soldOut ? t('outOfStock') : t('available', { count: product.stock ?? 0 })}
                    >
                        {soldOut ? t('outOfStock') : t('left', { count: product.stock ?? 0 })}
                    </Badge>
                    {product.category && (
                        <Badge variant="outline" className="text-[10px] max-w-full truncate whitespace-nowrap">
                            {product.category.name}
                        </Badge>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
