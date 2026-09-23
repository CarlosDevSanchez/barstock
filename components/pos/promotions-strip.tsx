'use client'

import { useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { PromotionListItem } from '@/lib/api/promotions'
import { Button } from '@/components/ui/button'
import { PromotionCard } from './promotion-card'
import { PromotionsBrowserDialog } from './promotions-browser-dialog'

interface PromotionsStripProps {
    promotions: PromotionListItem[]
    loading: boolean
    pendingId: string | null
    pendingQty: number
    qtyInCart: (promotionId: string) => number
    onSelect: (promotionId: string) => void
    onChangeQty: (qty: number) => void
    onConfirm: () => void
}

const pendingKey = (id: string) => `promo:${id}`

/** Active packages above the product grid. Hidden when the store has none. */
export function PromotionsStrip({
    promotions,
    loading,
    pendingId,
    pendingQty,
    qtyInCart,
    onSelect,
    onChangeQty,
    onConfirm
}: PromotionsStripProps) {
    const t = useTranslations('pos')
    const [browseOpen, setBrowseOpen] = useState(false)

    if (!loading && promotions.length === 0) return null

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-muted-foreground">{t('promotions')}</h2>
                {!loading && promotions.length > 0 && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-muted-foreground"
                        onClick={() => setBrowseOpen(true)}
                        aria-label={t('promotionsExpand')}
                    >
                        <Maximize2 className="h-3.5 w-3.5" />
                        {t('promotionsExpand')}
                    </Button>
                )}
            </div>
            {loading ? (
                <div className="flex gap-3 overflow-x-auto pb-1">
                    {Array.from({ length: 3 }, (_, i) => (
                        <div key={i} className="w-36 shrink-0 rounded-xl overflow-hidden border animate-pulse">
                            <div className="aspect-[4/3] w-full bg-muted" />
                            <div className="p-2.5 space-y-2">
                                <div className="h-3 bg-muted rounded w-3/4" />
                                <div className="h-4 bg-muted rounded w-1/2" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 pt-2">
                    {promotions.map(promo => {
                        const key = pendingKey(promo.id)
                        return (
                            <div key={promo.id} className="w-44 h-full shrink-0">
                                <PromotionCard
                                    promotion={promo}
                                    pending={pendingId === key}
                                    qty={pendingId === key ? pendingQty : 1}
                                    qtyInCart={qtyInCart(promo.id)}
                                    onSelect={() => onSelect(promo.id)}
                                    onChangeQty={onChangeQty}
                                    onConfirm={onConfirm}
                                />
                            </div>
                        )
                    })}
                </div>
            )}

            <PromotionsBrowserDialog
                open={browseOpen}
                onOpenChange={setBrowseOpen}
                promotions={promotions}
                pendingId={pendingId}
                pendingQty={pendingQty}
                qtyInCart={qtyInCart}
                onSelect={onSelect}
                onChangeQty={onChangeQty}
                onConfirm={onConfirm}
            />
        </div>
    )
}

export { pendingKey as promoPendingKey }
