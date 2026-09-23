'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ShoppingCart } from 'lucide-react'
import { useMoney } from '@/components/session-provider'
import { cn } from '@/lib/utils'

export interface CartBubbleLine {
    productId: string
    name: string
    quantity: number
}

interface CartBubbleProps {
    itemCount: number
    total: number
    lines: CartBubbleLine[]
    /** True when at least one line cannot be sold (stock or price changed): shown in red. */
    hasProblem: boolean
    /** Pre-formatted "N cuentas abiertas" pill (tabs feature); omitted until there is at least one open tab. */
    openTabsLabel?: string
    onClick: () => void
}

/** Floating cart button (replaces the fixed side column): a bounce on add, a hover preview of the last lines, and a
 * click opens the full cart sheet. Always rendered — shows a "0" badge when the cart is empty — so the button is a
 * stable, discoverable affordance instead of appearing/disappearing as items are added. */
export function CartBubble({ itemCount, total, lines, hasProblem, openTabsLabel, onClick }: CartBubbleProps) {
    const t = useTranslations('pos')
    const money = useMoney()
    const [bump, setBump] = useState(false)
    // Adjusts state during render when `itemCount` grows (React's documented alternative to an effect that would
    // only mirror a prop change into state): a CSS transition plays the bounce, and its own end event turns it off.
    const [previousCount, setPreviousCount] = useState(itemCount)
    if (itemCount !== previousCount) {
        if (itemCount > previousCount) setBump(true)
        setPreviousCount(itemCount)
    }

    return (
        <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] right-4 z-40 group touch-manipulation lg:bottom-6 lg:right-6">
            {itemCount > 0 && (
                <div className="hidden sm:block absolute bottom-full right-0 mb-2 w-64 rounded-xl border bg-popover p-3 text-sm shadow-lg opacity-0 pointer-events-none -translate-y-1 transition-all group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0">
                    <ul className="space-y-1">
                        {lines.slice(-3).map(line => (
                            <li key={line.productId} className="flex justify-between gap-2">
                                <span className="truncate">
                                    {line.quantity}× {line.name}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <div className="mt-2 pt-2 border-t flex justify-between font-semibold">
                        <span>{t('total')}</span>
                        <span>{money(total)}</span>
                    </div>
                </div>
            )}
            <button
                type="button"
                onClick={onClick}
                onTransitionEnd={() => setBump(false)}
                aria-label={t('cartBubble', { count: itemCount, total: money(total) })}
                className={cn(
                    'flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full shadow-xl px-4 py-3 text-white transition-transform duration-300',
                    hasProblem ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700',
                    bump && 'scale-110'
                )}
            >
                <span className="relative shrink-0">
                    <ShoppingCart className="h-6 w-6" />
                    <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-xs font-bold text-emerald-700">
                        {itemCount}
                    </span>
                </span>
                {itemCount > 0 && <span className="truncate font-semibold">{money(total)}</span>}
                {openTabsLabel && (
                    <span className="shrink-0 truncate rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium">
                        {openTabsLabel}
                    </span>
                )}
            </button>
        </div>
    )
}
