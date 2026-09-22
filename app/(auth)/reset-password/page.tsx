'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { useHydrated } from '@/hooks/use-hydrated'
import { authApi } from '@/lib/api/auth'
import { ApiError, errorMessage } from '@/lib/api/client'
import { resetPasswordSchema } from '@/lib/validation/resources'
import { useState } from 'react'

const formSchema = resetPasswordSchema
    .extend({ confirm: z.string() })
    .refine(values => values.password === values.confirm, { path: ['confirm'], message: 'Passwords do not match' })

// Reached from the email link (/auth/confirm exchanges the one-time token for a session first). Serves both
// "accept an invitation" and "reset a forgotten password": in both cases the user is signed in and picks a password.
export default function ResetPasswordPage() {
    const router = useRouter()
    const [expired, setExpired] = useState(false)
    const hydrated = useHydrated()
    const form = useForm({ resolver: zodResolver(formSchema), defaultValues: { password: '', confirm: '' } })

    const onSubmit = form.handleSubmit(async values => {
        try {
            await authApi.resetPassword(values.password)
            toast.success('Password saved')
            router.push('/dashboard')
            router.refresh()
        } catch (error: unknown) {
            if (error instanceof ApiError && error.status === 401) {
                setExpired(true)
                return
            }
            toast.error(errorMessage(error, 'Could not save the password'))
        }
    })

    const submitting = form.formState.isSubmitting

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-slate-50 dark:from-slate-900 dark:via-slate-800 dark:to-emerald-950 p-4">
            <Card className="w-full max-w-md shadow-2xl">
                <CardHeader className="space-y-1">
                    <div className="flex items-center justify-center mb-4">
                        <div className="p-3 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30">
                            <KeyRound className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl text-center font-bold">Choose your password</CardTitle>
                    <CardDescription className="text-center">
                        {expired
                            ? 'This link has expired or was already used.'
                            : 'Use at least 10 characters. A passphrase works well.'}
                    </CardDescription>
                </CardHeader>
                {expired ? (
                    <CardFooter className="justify-center">
                        <Link
                            href="/forgot-password"
                            className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                        >
                            Request a new link
                        </Link>
                    </CardFooter>
                ) : (
                    <Form {...form}>
                        <form method="post" onSubmit={onSubmit} noValidate>
                            <CardContent className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="password"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>New password</FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="password"
                                                    autoComplete="new-password"
                                                    disabled={submitting}
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="confirm"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Confirm password</FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="password"
                                                    autoComplete="new-password"
                                                    disabled={submitting}
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </CardContent>
                            <CardFooter>
                                <Button type="submit" className="w-full" size="lg" disabled={submitting || !hydrated}>
                                    {submitting ? 'Saving...' : 'Save password'}
                                </Button>
                            </CardFooter>
                        </form>
                    </Form>
                )}
            </Card>
        </div>
    )
}
