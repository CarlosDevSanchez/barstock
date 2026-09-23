import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/pwa/sw-register'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'

const geistSans = Geist({
    variable: '--font-geist-sans',
    subsets: ['latin']
})

const geistMono = Geist_Mono({
    variable: '--font-geist-mono',
    subsets: ['latin']
})

export const metadata: Metadata = {
    title: 'Barstock POS System',
    description: 'Sistema de gestion de inventario y ventas para bares',
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Barstock' }
}

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#059669' },
        { media: '(prefers-color-scheme: dark)', color: '#0f172a' }
    ]
}

export default async function RootLayout({
    children
}: Readonly<{
    children: React.ReactNode
}>) {
    const locale = await getLocale()
    return (
        <html lang={locale} suppressHydrationWarning>
            <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
                <NextIntlClientProvider>
                    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
                        {children}
                        <Toaster richColors position="top-right" />
                        <ServiceWorkerRegister />
                    </ThemeProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    )
}
