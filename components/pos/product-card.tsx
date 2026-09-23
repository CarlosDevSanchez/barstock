'use client'

import { ShoppingCart } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useMoney } from '@/components/session-provider'
import { useImageFallback } from '@/hooks/use-image-fallback'
import type { ProductListItem } from '@/lib/api/products'
import { QtyConfirmOverlay } from './qty-confirm-overlay'

interface ProductCardProps {
    product: ProductListItem
    /** True when this tile is the one pending quantity confirmation. */
    pending: boolean
    /** Draft quantity while pending (parent-owned). */
    qty: number
    /** Max units still addable: stock − already in cart. */
    maxQty: number
    onSelect: () => void
    onChangeQty: (qty: number) => void
    onConfirm: () => void
}

/**
 * Compact tile for the POS grid. Tap opens an inline −/+/Confirm stepper (quantity lives on the POS page so only
 * one tile is pending at a time). The image strip, name, price and badge row each sit on their own line so a long
 * name or a long category never pushes the price out of view (`min-w-0` + `flex-wrap`).
 */
export function ProductCard({ product, pending, qty, maxQty, onSelect, onChangeQty, onConfirm }: ProductCardProps) {
    const t = useTranslations('pos')
    const money = useMoney()
    const { showImage, onError: onImageError } = useImageFallback(product.image_url)
    // stock null = no inventory row, which the database refuses to sell.
    const soldOut = product.stock === null || product.stock <= 0
    const canAdd = !soldOut && maxQty > 0

    return (
        <Card
            role="button"
            aria-disabled={!canAdd && !pending}
            aria-label={t('addToCart', { name: product.name })}
            title={t('sku', { sku: product.sku })}
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
            <div className="aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-emerald-50 to-slate-50 dark:from-emerald-950/20 dark:to-slate-900 flex items-center justify-center shrink-0">
                {showImage ? (
                    // eslint-disable-next-line @next/next/no-img-element -- untrusted, arbitrary-sized product images
                    <img
                        src={product.image_url ?? undefined}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-contain product-image-back"
                        onError={onImageError}
                    />
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

            {pending && <QtyConfirmOverlay qty={qty} maxQty={maxQty} onChangeQty={onChangeQty} onConfirm={onConfirm} />}
        </Card>
    )
}
