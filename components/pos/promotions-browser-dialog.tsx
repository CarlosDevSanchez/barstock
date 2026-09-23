'use client'

import { useTranslations } from 'next-intl'
import type { PromotionListItem } from '@/lib/api/promotions'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PromotionCard } from './promotion-card'

interface PromotionsBrowserDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    promotions: PromotionListItem[]
    pendingId: string | null
    pendingQty: number
    qtyInCart: (promotionId: string) => number
    onSelect: (promotionId: string) => void
    onChangeQty: (qty: number) => void
    onConfirm: () => void
}

/** Full-catalog browser for POS packages. Stays open after confirm so several can be added. */
export function PromotionsBrowserDialog({
    open,
    onOpenChange,
    promotions,
    pendingId,
    pendingQty,
    qtyInCart,
    onSelect,
    onChangeQty,
    onConfirm
}: PromotionsBrowserDialogProps) {
    const t = useTranslations('pos')

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col gap-3">
                <DialogHeader>
                    <DialogTitle>{t('promotionsBrowseTitle')}</DialogTitle>
                    <DialogDescription>{t('promotionsBrowseDesc')}</DialogDescription>
                </DialogHeader>
                <div className="overflow-y-auto -mx-1 px-1 pb-1">
                    {promotions.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">{t('promotions')}</p>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {promotions.map(promo => {
                                const key = `promo:${promo.id}`
                                return (
                                    <PromotionCard
                                        key={promo.id}
                                        promotion={promo}
                                        pending={pendingId === key}
                                        qty={pendingId === key ? pendingQty : 1}
                                        qtyInCart={qtyInCart(promo.id)}
                                        onSelect={() => onSelect(promo.id)}
                                        onChangeQty={onChangeQty}
                                        onConfirm={onConfirm}
                                    />
                                )
                            })}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
