"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'

export default function ForgotPasswordPage() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [loading, setLoading] = useState(false)
    const [sent, setSent] = useState(false)

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
            })

            if (error) throw error

            setSent(true)
            toast.success('Password reset email sent! Please check your inbox.')
        } catch (error: any) {
            toast.error(error.message || 'Failed to send reset email')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-slate-50 dark:from-slate-900 dark:via-slate-800 dark:to-emerald-950 p-4">
            <Card className="w-full max-w-md shadow-2xl">
                <CardHeader className="space-y-1">
                    <div className="flex items-center justify-center mb-4">
                        <div className="p-3 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30">
                            <KeyRound className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl text-center font-bold">Forgot Password?</CardTitle>
                    <CardDescription className="text-center">
                        Enter your email and we'll send you a reset link
                    </CardDescription>
                </CardHeader>
                {!sent ? (
                    <form onSubmit={handleResetPassword}>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="name@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    disabled={loading}
                                />
                            </div>
                        </CardContent>
                        <CardFooter className="flex flex-col space-y-4">
                            <Button
                                type="submit"
                                className="w-full"
                                size="lg"
                                disabled={loading}
                            >
                                {loading ? 'Sending...' : 'Send Reset Link'}
                            </Button>
                            <p className="text-sm text-center text-muted-foreground">
                                Remember your password?{' '}
                                <Link
                                    href="/login"
                                    className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 font-medium"
                                >
                                    Sign in
                                </Link>
                            </p>
                        </CardFooter>
                    </form>
                ) : (
                    <CardContent className="space-y-4">
                        <div className="text-center space-y-2">
                            <p className="text-sm text-muted-foreground">
                                We've sent a password reset link to <strong>{email}</strong>
                            </p>
                            <p className="text-sm text-muted-foreground">
                                Please check your inbox and follow the instructions.
                            </p>
                        </div>
                        <Button
                            onClick={() => router.push('/login')}
                            className="w-full"
                            variant="outline"
                        >
                            Back to Login
                        </Button>
                    </CardContent>
                )}
            </Card>
        </div>
    )
}
