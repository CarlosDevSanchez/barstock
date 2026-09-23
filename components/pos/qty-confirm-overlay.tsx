'use client'

import { Minus, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface QtyConfirmOverlayProps {
    qty: number
    maxQty: number
    onChangeQty: (qty: number) => void
    onConfirm: () => void
    /** Extra classes on the absolute overlay shell (e.g. rounded-xl for Top 5). */
    className?: string
    /**
     * What the stepper counts. Products use units (default); promotions use packages so the
     * number is never confused with the recipe component count.
     */
    unit?: 'units' | 'packages'
}

/** Inline − / qty / + / Confirm overlay used by ProductCard, TopProducts, and PromotionCard. */
export function QtyConfirmOverlay({
    qty,
    maxQty,
    onChangeQty,
    onConfirm,
    className = '',
    unit = 'units'
}: QtyConfirmOverlayProps) {
    const t = useTranslations('pos')
    const decreaseLabel = unit === 'packages' ? t('decreasePackages') : t('decreaseQty')
    const increaseLabel = unit === 'packages' ? t('increasePackages') : t('increaseQty')

    return (
        <div
            className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/90 p-2 ${className}`}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
        >
            <div className="flex items-center gap-1.5">
                <Button
                    type="button"
                    size="icon-xs"
                    variant="outline"
                    aria-label={decreaseLabel}
                    onClick={() => onChangeQty(qty - 1)}
                >
                    <Minus />
                </Button>
                <div className="flex flex-col items-center min-w-8">
                    <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                        {qty}
                    </span>
                    {unit === 'packages' && (
                        <span className="text-[10px] leading-none text-muted-foreground">{t('packagesUnit')}</span>
                    )}
                </div>
                <Button
                    type="button"
                    size="icon-xs"
                    variant="outline"
                    aria-label={increaseLabel}
                    disabled={qty >= maxQty}
                    onClick={() => onChangeQty(qty + 1)}
                >
                    <Plus />
                </Button>
            </div>
            <Button type="button" size="xs" className="w-full" disabled={qty < 1} onClick={onConfirm}>
                {t('confirmQty')}
            </Button>
        </div>
    )
}

/** Units (or packages) still addable: stock − already in cart. */
export function maxAddable(stock: number | null, inCart: number): number {
    if (stock === null || stock <= 0) return 0
    return Math.max(0, stock - inCart)
}
