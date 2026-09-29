'use client'

import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useMoney, useSession } from '@/components/session-provider'
import { moneyLocale } from '@/lib/i18n/config'
import { productMargins } from '@/lib/margin'
import { cn } from '@/lib/utils'

/** A number typed in a price input (always a string), or null while it is empty or not a number. */
const typedAmount = (value: unknown): number | null => {
    if (typeof value !== 'string' || value.trim() === '') return null
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : null
}

/**
 * Read-only margins of the product form, recalculated as the cost and the selling price are typed. Nothing here is
 * saved: it mirrors the business's pricing spreadsheet (lib/margin.ts). The target markup comes from Settings.
 */
export function MarginSummary() {
    const t = useTranslations('products')
    const money = useMoney()
    const { settings, user } = useSession()
    const form = useFormContext()
    const cost = typedAmount(useWatch({ name: 'cost_price' }))
    const price = typedAmount(useWatch({ name: 'selling_price' }))

    const percent = new Intl.NumberFormat(moneyLocale(user.locale), { style: 'percent', maximumFractionDigits: 2 })
    const margins = cost === null ? null : productMargins(cost, price ?? 0, settings.target_margin, settings.currency)
    const hasPrice = margins !== null && price !== null
    const belowTarget = hasPrice && price < margins.suggestedPrice

    const rows = [
        { key: 'target', label: t('targetMargin'), value: percent.format(settings.target_margin) },
        { key: 'markup', label: t('markupAmount'), value: margins ? money(margins.markupAmount) : '—' },
        { key: 'suggested', label: t('suggestedPrice'), value: margins ? money(margins.suggestedPrice) : '—' },
        {
            key: 'profit',
            label: t('unitProfit'),
            value: hasPrice ? money(margins.profit) : '—',
            negative: hasPrice && margins.profit < 0
        },
        {
            key: 'real',
            label: t('realMargin'),
            value: hasPrice && margins.realMargin !== null ? percent.format(margins.realMargin) : '—',
            negative: hasPrice && margins.profit < 0
        }
    ]

    return (
        <section className="col-span-2 space-y-3 rounded-md border p-4" aria-label={t('marginTitle')}>
            <div>
                <h3 className="text-sm font-medium">{t('marginTitle')}</h3>
                <p className="text-sm text-muted-foreground">{t('marginHint')}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm sm:grid-cols-4">
                {rows.map(row => (
                    <div key={row.key} className="min-w-0">
                        <dt className="text-muted-foreground">{row.label}</dt>
                        <dd
                            className={cn('font-medium tabular-nums', row.negative && 'text-destructive')}
                            data-testid={`margin-${row.key}`}
                        >
                            {row.value}
                        </dd>
                    </div>
                ))}
            </dl>
            {belowTarget && margins && (
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-muted-foreground">{t('belowTarget')}</p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            form.setValue('selling_price', String(margins.suggestedPrice), {
                                shouldDirty: true,
                                shouldValidate: true
                            })
                        }
                    >
                        {t('useSuggestedPrice', { price: money(margins.suggestedPrice) })}
                    </Button>
                </div>
            )}
        </section>
    )
}
