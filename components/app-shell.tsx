'use client'

import type { ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { apiPatch, apiPost, errorMessage } from '@/lib/api/client'
import { roleAtLeast, type UserRole } from '@/lib/auth/roles'
import { APP_LOCALES, type AppLocale } from '@/lib/i18n/config'
import { useCartStore } from '@/stores/cart'
import type { SettingsInput } from '@/lib/validation/resources'
import { SessionProvider, type SessionUser } from '@/components/session-provider'
import { useTheme } from 'next-themes'
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    Warehouse,
    ShoppingBag,
    Users,
    Truck,
    BarChart3,
    Settings2,
    Menu,
    Moon,
    Sun,
    LogOut,
    FolderTree,
    UserCog
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems: Array<{
    icon: typeof LayoutDashboard
    href: string
    minimumRole: UserRole
    key:
        | 'dashboard'
        | 'pos'
        | 'products'
        | 'categories'
        | 'inventory'
        | 'orders'
        | 'customers'
        | 'suppliers'
        | 'reports'
        | 'settings'
        | 'users'
}> = [
    { icon: LayoutDashboard, key: 'dashboard', href: '/dashboard', minimumRole: 'cashier' },
    { icon: ShoppingCart, key: 'pos', href: '/pos', minimumRole: 'cashier' },
    { icon: Package, key: 'products', href: '/products', minimumRole: 'cashier' },
    { icon: FolderTree, key: 'categories', href: '/categories', minimumRole: 'cashier' },
    { icon: Warehouse, key: 'inventory', href: '/inventory', minimumRole: 'cashier' },
    { icon: ShoppingBag, key: 'orders', href: '/orders', minimumRole: 'cashier' },
    { icon: Users, key: 'customers', href: '/customers', minimumRole: 'cashier' },
    { icon: Truck, key: 'suppliers', href: '/suppliers', minimumRole: 'manager' },
    { icon: BarChart3, key: 'reports', href: '/reports', minimumRole: 'manager' },
    { icon: Settings2, key: 'settings', href: '/settings', minimumRole: 'admin' },
    { icon: UserCog, key: 'users', href: '/users', minimumRole: 'admin' }
]

interface AppShellProps {
    user: SessionUser
    settings: SettingsInput
    children: ReactNode
}

export function AppShell({ user, settings, children }: AppShellProps) {
    const router = useRouter()
    const pathname = usePathname()
    const { theme, setTheme } = useTheme()
    const tNav = useTranslations('nav')
    const t = useTranslations('common')
    const clearCart = useCartStore(state => state.clearCart)
    const visibleNav = navItems.filter(item => roleAtLeast(user.role, item.minimumRole))
    const displayName = user.fullName || user.email

    const handleLogout = async () => {
        try {
            await apiPost('auth/logout')
        } catch {
            toast.error(t('signOutFailed'))
            return
        }
        // The cart belongs to the session: never leave it behind for the next person at this till.
        clearCart()
        router.push('/login')
        router.refresh()
    }

    const setLocale = async (locale: AppLocale) => {
        if (locale === user.locale) return
        try {
            await apiPatch('me', { locale })
            router.refresh()
        } catch (error: unknown) {
            toast.error(errorMessage(error))
        }
    }

    const navLinks = (
        <>
            {visibleNav.map(item => {
                const Icon = item.icon
                const isActive = pathname === item.href
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                            'flex items-center gap-3 px-4 py-3 rounded-xl transition-all',
                            isActive
                                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                    >
                        <Icon className="w-5 h-5" />
                        {tNav(item.key)}
                    </Link>
                )
            })}
        </>
    )

    const accountMenu = (
        <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('language')}</DropdownMenuLabel>
            {APP_LOCALES.map(locale => (
                <DropdownMenuItem
                    key={locale}
                    onClick={() => setLocale(locale)}
                    className={cn(user.locale === locale && 'font-medium text-emerald-700')}
                >
                    {locale === 'es' ? 'Español' : 'English'}
                </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                {theme === 'dark' ? t('themeLight') : t('themeDark')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                {t('signOut')}
            </DropdownMenuItem>
        </DropdownMenuContent>
    )

    return (
        <SessionProvider value={{ user, settings }}>
            <div className="flex h-screen overflow-hidden">
                <aside className="hidden lg:flex w-64 flex-col border-r bg-card">
                    <div className="p-6">
                        <h1 className="text-2xl font-bold text-emerald-600">{settings.store_name}</h1>
                    </div>
                    <nav className="flex-1 px-4 space-y-1 overflow-y-auto">{navLinks}</nav>
                    <div className="p-4 border-t">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="w-full justify-start gap-3">
                                    <Avatar>
                                        <AvatarFallback className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                                            {displayName.charAt(0).toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex flex-col items-start text-sm">
                                        <span className="font-medium truncate max-w-32">{displayName}</span>
                                        <span className="text-xs text-muted-foreground">{t(`role.${user.role}`)}</span>
                                    </div>
                                </Button>
                            </DropdownMenuTrigger>
                            {accountMenu}
                        </DropdownMenu>
                    </div>
                </aside>

                <div className="flex-1 flex flex-col overflow-hidden">
                    <header className="lg:hidden flex items-center justify-between p-4 border-b bg-card">
                        <Sheet>
                            <SheetTrigger asChild>
                                <Button variant="ghost" size="icon">
                                    <Menu className="h-6 w-6" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="w-64 p-0">
                                <div className="p-6">
                                    <h1 className="text-2xl font-bold text-emerald-600">{settings.store_name}</h1>
                                </div>
                                <nav className="px-4 space-y-1">{navLinks}</nav>
                            </SheetContent>
                        </Sheet>
                        <h1 className="text-xl font-bold text-emerald-600">{settings.store_name}</h1>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                    <Avatar>
                                        <AvatarFallback className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                                            {displayName.charAt(0).toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                </Button>
                            </DropdownMenuTrigger>
                            {accountMenu}
                        </DropdownMenu>
                    </header>

                    <main className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-900">{children}</main>
                </div>
            </div>
        </SessionProvider>
    )
}
