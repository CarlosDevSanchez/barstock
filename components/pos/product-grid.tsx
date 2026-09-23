'use client'

import { useEffect, useEffectEvent, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { QueryError } from '@/components/query-error'
import type { ProductListItem } from '@/lib/api/products'
import type { InfiniteApiList } from '@/hooks/use-infinite-api-list'
import { ProductCard } from './product-card'
import { maxAddable } from './qty-confirm-overlay'

interface ProductGridProps {
    catalog: InfiniteApiList<ProductListItem>
    pendingId: string | null
    pendingQty: number
    /** Units of this product already in the cart (for the addable cap). */
    qtyInCart: (productId: string) => number
    onSelect: (productId: string) => void
    onChangeQty: (qty: number) => void
    onConfirm: () => void
}

const GRID_CLASSES = 'grid grid-cols-2 @md:grid-cols-3 @2xl:grid-cols-4 @5xl:grid-cols-6 gap-3'

function CardSkeleton() {
    return (
        <div className="min-w-0 rounded-xl overflow-hidden border animate-pulse">
            <div className="aspect-[4/3] w-full bg-muted" />
            <div className="p-2.5 space-y-2">
                <div className="h-3 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-1/2" />
                <div className="h-4 bg-muted rounded w-2/3" />
            </div>
        </div>
    )
}

/** Grid + infinite scroll for the POS catalog. The scroll itself happens on `<main>` (app-shell); this only watches
 * a sentinel at the end of the list and asks the hook for the next page when it comes into view. Sized off the grid's
 * own width via a container query (`@container`), not the viewport, since the sidebar and cart bubble change how much
 * width is actually available. */
export function ProductGrid({
    catalog,
    pendingId,
    pendingQty,
    qtyInCart,
    onSelect,
    onChangeQty,
    onConfirm
}: ProductGridProps) {
    const t = useTranslations('pos')
    const sentinelRef = useRef<HTMLDivElement>(null)
    const handleIntersect = useEffectEvent((intersecting: boolean) => {
        if (intersecting) catalog.loadMore()
    })

    useEffect(() => {
        const sentinel = sentinelRef.current
        if (!sentinel || typeof IntersectionObserver === 'undefined') return
        const observer = new IntersectionObserver(
            entries => handleIntersect(entries.some(entry => entry.isIntersecting)),
            { rootMargin: '400px' }
        )
        observer.observe(sentinel)
        return () => observer.disconnect()
        // Re-attaches whenever the list grows or the first page settles, so the sentinel is re-checked against the
        // (possibly now taller) page and a still-visible sentinel keeps pulling more pages.
    }, [catalog.items.length, catalog.loading])

    if (catalog.error) return <QueryError error={catalog.error} onRetry={catalog.reload} />

    if (catalog.loading) {
        return (
            <div className="@container">
                <div className={GRID_CLASSES}>
                    {Array.from({ length: 12 }, (_, index) => (
                        <CardSkeleton key={index} />
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="@container">
            <div className={GRID_CLASSES}>
                {catalog.items.map(product => {
                    const maxQty = maxAddable(product.stock, qtyInCart(product.id))
                    return (
                        <ProductCard
                            key={product.id}
                            product={product}
                            pending={pendingId === product.id}
                            qty={pendingId === product.id ? pendingQty : 1}
                            maxQty={maxQty}
                            onSelect={() => onSelect(product.id)}
                            onChangeQty={onChangeQty}
                            onConfirm={onConfirm}
                        />
                    )
                })}
            </div>
            {catalog.items.length === 0 && <p className="py-8 text-center text-muted-foreground">{t('noProducts')}</p>}
            {catalog.loadingMore && (
                <>
                    <p role="status" className="sr-only">
                        {t('loadingMore')}
                    </p>
                    <div className={`${GRID_CLASSES} mt-3`}>
                        {Array.from({ length: 6 }, (_, index) => (
                            <CardSkeleton key={index} />
                        ))}
                    </div>
                </>
            )}
            {catalog.items.length > 0 && !catalog.hasMore && !catalog.loadingMore && (
                <p className="py-4 text-center text-sm text-muted-foreground">{t('endOfList')}</p>
            )}
            <div ref={sentinelRef} aria-hidden className="h-px" />
        </div>
    )
}
