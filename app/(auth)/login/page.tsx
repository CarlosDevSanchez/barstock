'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { TranslatedFormMessage } from '@/components/translated-form-message'
import { useHydrated } from '@/hooks/use-hydrated'
import { authApi } from '@/lib/api/auth'
import { errorMessage } from '@/lib/api/client'
import { APP_LOCALES, LOCALE_COOKIE, type AppLocale } from '@/lib/i18n/config'
import { loginSchema } from '@/lib/validation/resources'

/** Only same-site paths: never redirect to a URL taken from the query string. */
function safeNext(value: string | null): string {
    return value && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard'
}

export default function LoginPage() {
    const router = useRouter()
    const hydrated = useHydrated()
    const t = useTranslations('auth')
    const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })

    useEffect(() => {
        if (new URLSearchParams(window.location.search).get('error') === 'invalid_link') {
            toast.error(t('invalidLink'))
        }
    }, [t])

    const onSubmit = form.handleSubmit(async values => {
        try {
            await authApi.login(values)
            router.push(safeNext(new URLSearchParams(window.location.search).get('next')))
            router.refresh()
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('loginFailed')))
        }
    })

    const submitting = form.formState.isSubmitting

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-slate-50 dark:from-slate-900 dark:via-slate-800 dark:to-emerald-950 p-4">
            <Card className="w-full max-w-md shadow-2xl">
                <CardHeader className="space-y-1">
                    <div className="flex items-center justify-center mb-4">
                        <div className="p-3 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30">
                            <LogIn className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl text-center font-bold">{t('welcomeBack')}</CardTitle>
                    <CardDescription className="text-center">{t('loginSubtitle')}</CardDescription>
                </CardHeader>
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
                                                autoComplete="username"
                                                placeholder="name@example.com"
                                                disabled={submitting}
                                                {...field}
                                            />
                                        </FormControl>
                                        <TranslatedFormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="password"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="flex items-center justify-between">
                                            <FormLabel>{t('password')}</FormLabel>
                                            <Link
                                                href="/forgot-password"
                                                className="text-sm text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                                            >
                                                {t('forgotPassword')}
                                            </Link>
                                        </div>
                                        <FormControl>
                                            <Input
                                                type="password"
                                                autoComplete="current-password"
                                                placeholder="••••••••"
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
                                {submitting ? t('signingIn') : t('signIn')}
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
            </Card>
        </div>
    )
}
