'use client'

import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
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

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'BRL', 'CAD']
const displayNames = new Intl.DisplayNames('en', { type: 'currency' })
const timeZones = Intl.supportedValuesOf('timeZone')

function toFormValues(settings: SettingsInput): FormInput {
    return {
        ...settings,
        tax_rate: String(Math.round(settings.tax_rate * 10_000) / 100),
        low_stock_threshold: String(settings.low_stock_threshold)
    }
}

export default function SettingsPage() {
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
            toast.success('Settings saved successfully!')
            // Re-runs the server layout so the new store name and currency apply everywhere.
            router.refresh()
        } catch (error: unknown) {
            toast.error(errorMessage(error, 'Failed to save settings'))
        }
    })

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Settings</h1>
                <p className="text-muted-foreground">Configure your store settings and preferences</p>
            </div>

            <Form {...form}>
                <form onSubmit={onSubmit} noValidate className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-2">
                        <Card className="rounded-2xl">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <SettingsIcon className="h-5 w-5 text-emerald-600" />
                                    Store Information
                                </CardTitle>
                                <CardDescription>Basic store details and contact information</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <TextField name="store_name" label="Store Name" />
                                <TextField name="store_address" label="Address" />
                                <TextField name="store_phone" label="Phone" />
                                <TextField name="store_email" label="Email" type="email" />
                            </CardContent>
                        </Card>

                        <Card className="rounded-2xl">
                            <CardHeader>
                                <CardTitle>Business Settings</CardTitle>
                                <CardDescription>Currency, tax, and operational settings</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <SelectField
                                    name="currency"
                                    label="Currency"
                                    placeholder="Currency"
                                    options={currencies}
                                />
                                <SelectField
                                    name="timezone"
                                    label="Time Zone"
                                    placeholder="Time zone"
                                    options={zones.map(zone => ({ value: zone, label: zone }))}
                                />
                                <TextField
                                    name="tax_rate"
                                    label="Default Tax Rate (%)"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                    description="Suggested rate for new products. Each product keeps its own rate."
                                />
                                <TextField
                                    name="low_stock_threshold"
                                    label="Low Stock Threshold"
                                    type="number"
                                    min="0"
                                    description="Applies to new products. Existing items keep their own threshold."
                                />
                            </CardContent>
                        </Card>

                        <Card className="rounded-2xl md:col-span-2">
                            <CardHeader>
                                <CardTitle>Receipt</CardTitle>
                                <CardDescription>Text printed at the top and bottom of a receipt</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-4 md:grid-cols-2">
                                <TextField name="receipt_template.header" label="Header" />
                                <TextField name="receipt_template.footer" label="Footer" />
                            </CardContent>
                        </Card>
                    </div>

                    <div className="flex justify-end">
                        <Button type="submit" size="lg" disabled={submitting || !form.formState.isDirty}>
                            <Save className="mr-2 h-4 w-4" />
                            {submitting ? 'Saving…' : 'Save Settings'}
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    )
}
