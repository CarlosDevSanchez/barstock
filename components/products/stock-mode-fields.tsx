'use client'

import { useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { FormField, FormItem, FormLabel } from '@/components/ui/form'
import { SearchableSelect } from '@/components/searchable-select'
import { SelectField, TextField } from '@/components/form-fields'
import { TranslatedFormMessage } from '@/components/translated-form-message'
import { useMoney } from '@/components/session-provider'
import { productsApi } from '@/lib/api/products'
import type { StockMode } from '@/lib/stock'
import { useApiQuery } from '@/hooks/use-api-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

interface StockModeFieldsProps {
    /** The product being edited (it can never be its own base); null while creating. */
    productId: string | null
    /** Name of the base already linked (or preset by "Create presentation"), shown before any search runs. */
    initialBase: { id: string; name: string } | null
}

/**
 * The "Inventory" part of the product form: whether the product counts its own units, never runs out (coffee), or is
 * a presentation that sells N units of another product (a box of 15 cigarettes). The DB enforces the same rules
 * (products_stock_mode_guard); this only makes them easy to fill in.
 */
export function StockModeFields({ productId, initialBase }: StockModeFieldsProps) {
    const t = useTranslations('products')
    const money = useMoney()
    const form = useFormContext()
    const mode = useWatch({ name: 'stock_mode' }) as StockMode
    const baseId = useWatch({ name: 'stock_product_id' }) as string
    const units = Number(useWatch({ name: 'stock_units' }))

    const [search, setSearch] = useState('')
    const debouncedSearch = useDebouncedValue(search)
    const bases = useApiQuery(
        signal =>
            mode === 'linked'
                ? productsApi.list({ q: debouncedSearch, stock_mode: 'own', active: true, pageSize: 20 }, signal)
                : Promise.resolve(null),
        JSON.stringify({ mode, debouncedSearch })
    )
    const candidates = (bases.data?.data ?? []).filter(candidate => candidate.id !== productId)
    const selected = candidates.find(candidate => candidate.id === baseId)
    const options = [
        ...(baseId && !selected && initialBase?.id === baseId ? [{ value: baseId, label: initialBase.name }] : []),
        ...candidates.map(candidate => ({
            value: candidate.id,
            label: candidate.name,
            sublabel: t('baseStock', { stock: candidate.stock ?? 0 })
        }))
    ]
    const validUnits = Number.isInteger(units) && units >= 2
    const suggestedCost = selected && validUnits ? selected.cost_price * units : null

    return (
        <div className="col-span-2 space-y-4 rounded-md border p-4">
            <SelectField
                name="stock_mode"
                label={t('stockMode')}
                placeholder={t('stockMode')}
                options={[
                    { value: 'own', label: t('stockModeOwn') },
                    { value: 'none', label: t('stockModeNone') },
                    { value: 'linked', label: t('stockModeLinked') }
                ]}
            />
            <p className="text-sm text-muted-foreground">
                {mode === 'none'
                    ? t('stockModeNoneHint')
                    : mode === 'linked'
                      ? t('stockModeLinkedHint')
                      : t('stockModeOwnHint')}
            </p>

            {mode === 'linked' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                        name="stock_product_id"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('stockBase')}</FormLabel>
                                <SearchableSelect
                                    value={field.value ?? ''}
                                    onValueChange={field.onChange}
                                    search={search}
                                    onSearchChange={setSearch}
                                    placeholder={t('stockBasePlaceholder')}
                                    options={options}
                                />
                                <TranslatedFormMessage />
                            </FormItem>
                        )}
                    />
                    <TextField
                        name="stock_units"
                        label={t('stockUnits')}
                        description={t('stockUnitsHint')}
                        type="number"
                        step="1"
                        min="2"
                    />
                    {selected && validUnits && (
                        <p className="text-sm sm:col-span-2" data-testid="stock-link-preview">
                            {t('stockLinkPreview', {
                                units,
                                base: selected.name,
                                available: Math.floor((selected.stock ?? 0) / units)
                            })}
                        </p>
                    )}
                    {suggestedCost !== null && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="sm:col-span-2 justify-self-start"
                            onClick={() => form.setValue('cost_price', String(suggestedCost), { shouldDirty: true })}
                        >
                            {t('useSuggestedCost', { cost: money(suggestedCost) })}
                        </Button>
                    )}
                </div>
            )}
        </div>
    )
}
