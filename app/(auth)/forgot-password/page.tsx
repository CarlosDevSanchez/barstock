'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { BarstockIcon } from '@/components/branding/barstock-mark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { TranslatedFormMessage } from '@/components/translated-form-message'
import { useHydrated } from '@/hooks/use-hydrated'
import { authApi } from '@/lib/api/auth'
import { errorMessage } from '@/lib/api/client'
import { APP_LOCALES, LOCALE_COOKIE, type AppLocale } from '@/lib/i18n/config'
import { forgotPasswordSchema } from '@/lib/validation/resources'

export default function ForgotPasswordPage() {
    const router = useRouter()
    const [sent, setSent] = useState(false)
    const hydrated = useHydrated()
    const t = useTranslations('auth')
    const form = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } })

    const onSubmit = form.handleSubmit(async values => {
        try {
            await authApi.forgotPassword(values.email)
            setSent(true)
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('resetFailed')))
        }
    })

    const submitting = form.formState.isSubmitting

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-slate-50 dark:from-slate-900 dark:via-slate-800 dark:to-emerald-950 p-4">
            <Card className="w-full max-w-md shadow-2xl">
                <CardHeader className="space-y-1">
                    <div className="flex items-center justify-center mb-4">
                        <div className="p-4 rounded-2xl bg-emerald-600 dark:bg-emerald-700 shadow-lg">
                            <BarstockIcon className="w-12 h-12 text-white" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl text-center font-bold">{t('forgotTitle')}</CardTitle>
                    <CardDescription className="text-center">
                        {sent ? t('forgotSent') : t('forgotSubtitle')}
                    </CardDescription>
                </CardHeader>
                {!sent && (
                    <Form {...form}>
                        <form method="post" onSubmit={onSubmit} noValidate>
                            <CardContent className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="email"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('email')}</FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="email"
                                                    autoComplete="email"
                                                    placeholder="name@example.com"
                                                    disabled={submitting}
                                                    {...field}
                                                />
                                            </FormControl>
                                            <TranslatedFormMessage />
                                        </FormItem>
                                    )}
                                />
                            </CardContent>
                            <CardFooter className="flex flex-col space-y-4 mt-4">
                                <Button type="submit" className="w-full" size="lg" disabled={submitting || !hydrated}>
                                    {submitting ? t('sending') : t('sendReset')}
                                </Button>
                                <div className="flex justify-center gap-3 text-sm">
                                    {APP_LOCALES.map(locale => (
                                        <button
                                            key={locale}
                                            type="button"
                                            className="text-muted-foreground hover:text-emerald-600 underline-offset-4 hover:underline"
                                            onClick={() => {
                                                document.cookie = `${LOCALE_COOKIE}=${locale as AppLocale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`
                                                router.refresh()
                                            }}
                                        >
                                            {locale === 'es' ? 'Español' : 'English'}
                                        </button>
                                    ))}
                                </div>
                            </CardFooter>
                        </form>
                    </Form>
                )}
                <CardFooter className="justify-center">
                    <Link
                        href="/login"
                        className="flex items-center text-sm text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                    >
                        <ArrowLeft className="w-4 h-4 mr-1" />
                        {t('backToLogin')}
                    </Link>
                </CardFooter>
            </Card>
        </div>
    )
}
