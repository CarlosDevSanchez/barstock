'use client'

import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Settings as SettingsIcon, Save } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { SelectField, TextField } from '@/components/form-fields'
import { useSession } from '@/components/session-provider'
import { errorMessage } from '@/lib/api/client'
import { settingsApi } from '@/lib/api/settings'
import { taxRatePercent } from '@/lib/validation/common'
import { settingsSchema, type SettingsInput } from '@/lib/validation/resources'

// The API stores the default tax rate as a fraction (0.10); the form shows a percentage (10).
const formSchema = settingsSchema.extend({ tax_rate: taxRatePercent })
type FormInput = z.input<typeof formSchema>
type FormOutput = z.output<typeof formSchema>

const COMMON_CURRENCIES = ['COP', 'USD', 'EUR', 'GBP', 'MXN', 'ARS', 'CLP', 'PEN', 'BRL', 'CAD']
const timeZones = Intl.supportedValuesOf('timeZone')

function toFormValues(settings: SettingsInput): FormInput {
    return {
        ...settings,
        tax_rate: String(Math.round(settings.tax_rate * 10_000) / 100),
        low_stock_threshold: String(settings.low_stock_threshold)
    }
}

export default function SettingsPage() {
    const t = useTranslations('settings')
    const tc = useTranslations('common')
    const locale = useLocale()
    const displayNames = new Intl.DisplayNames(locale, { type: 'currency' })
    const router = useRouter()
    const { settings } = useSession()
    const form = useForm<FormInput, unknown, FormOutput>({
        resolver: zodResolver(formSchema),
        defaultValues: toFormValues(settings)
    })
    const submitting = form.formState.isSubmitting

    // Keep the stored currency selectable even when it is not one of the common ones.
    const currencies = [...new Set([...COMMON_CURRENCIES, settings.currency])].map(code => ({
        value: code,
        label: `${code} - ${displayNames.of(code) ?? code}`
    }))
    const zones = timeZones.includes(settings.timezone) ? timeZones : [settings.timezone, ...timeZones]

    const onSubmit = form.handleSubmit(async values => {
        try {
            const saved = await settingsApi.update(values)
            form.reset(toFormValues(saved))
            toast.success(t('saved'))
            // Re-runs the server layout so the new store name and currency apply everywhere.
            router.refresh()
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('saveFailed')))
        }
    })

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">{t('title')}</h1>
                <p className="text-muted-foreground">{t('subtitle')}</p>
            </div>

            <Form {...form}>
                <form onSubmit={onSubmit} noValidate className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-2">
                        <Card className="rounded-2xl">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <SettingsIcon className="h-5 w-5 text-emerald-600" />
                                    {t('storeInfo')}
                                </CardTitle>
                                <CardDescription>{t('storeInfoDesc')}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <TextField name="store_name" label={t('storeName')} />
                                <TextField name="store_address" label={t('address')} />
                                <TextField name="store_phone" label={t('phone')} />
                                <TextField name="store_email" label={t('email')} type="email" />
                            </CardContent>
                        </Card>

                        <Card className="rounded-2xl">
                            <CardHeader>
                                <CardTitle>{t('business')}</CardTitle>
                                <CardDescription>{t('businessDesc')}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <SelectField
                                    name="currency"
                                    label={t('currency')}
                                    placeholder={t('currency')}
                                    options={currencies}
                                />
                                <SelectField
                                    name="timezone"
                                    label={t('timezone')}
                                    placeholder={t('timezonePlaceholder')}
                                    options={zones.map(zone => ({ value: zone, label: zone }))}
                                />
                                <TextField
                                    name="tax_rate"
                                    label={t('defaultTaxRate')}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                    description={t('defaultTaxRateHint')}
                                />
                                <TextField
                                    name="low_stock_threshold"
                                    label={t('lowStockThreshold')}
                                    type="number"
                                    min="0"
                                    description={t('lowStockThresholdHint')}
                                />
                            </CardContent>
                        </Card>

                        <Card className="rounded-2xl md:col-span-2">
                            <CardHeader>
                                <CardTitle>{t('receipt')}</CardTitle>
                                <CardDescription>{t('receiptDesc')}</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-4 md:grid-cols-2">
                                <TextField name="receipt_template.header" label={t('header')} />
                                <TextField name="receipt_template.footer" label={t('footer')} />
                            </CardContent>
                        </Card>
                    </div>

                    <div className="flex justify-end">
                        <Button type="submit" size="lg" disabled={submitting || !form.formState.isDirty}>
                            <Save className="mr-2 h-4 w-4" />
                            {submitting ? tc('saving') : t('saveSettings')}
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    )
}
