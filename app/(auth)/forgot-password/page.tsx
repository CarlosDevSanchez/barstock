'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { ArrowLeft, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { useHydrated } from '@/hooks/use-hydrated'
import { authApi } from '@/lib/api/auth'
import { errorMessage } from '@/lib/api/client'
import { forgotPasswordSchema } from '@/lib/validation/resources'

export default function ForgotPasswordPage() {
    const [sent, setSent] = useState(false)
    const hydrated = useHydrated()
    const form = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } })

    const onSubmit = form.handleSubmit(async values => {
        try {
            await authApi.forgotPassword(values.email)
            setSent(true)
        } catch (error: unknown) {
            toast.error(errorMessage(error, 'Could not send the reset email'))
        }
    })

    const submitting = form.formState.isSubmitting

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-slate-50 dark:from-slate-900 dark:via-slate-800 dark:to-emerald-950 p-4">
            <Card className="w-full max-w-md shadow-2xl">
                <CardHeader className="space-y-1">
                    <div className="flex items-center justify-center mb-4">
                        <div className="p-3 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30">
                            <Mail className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl text-center font-bold">Forgot password?</CardTitle>
                    <CardDescription className="text-center">
                        {sent
                            ? 'If that email belongs to an account, a reset link is on its way. It may take a minute.'
                            : "Enter your email and we'll send you a link to reset your password"}
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
                                            <FormLabel>Email</FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="email"
                                                    autoComplete="email"
                                                    placeholder="name@example.com"
                                                    disabled={submitting}
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </CardContent>
                            <CardFooter className="flex flex-col space-y-4">
                                <Button type="submit" className="w-full" size="lg" disabled={submitting || !hydrated}>
                                    {submitting ? 'Sending...' : 'Send reset link'}
                                </Button>
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
                        Back to login
                    </Link>
                </CardFooter>
            </Card>
        </div>
    )
}
