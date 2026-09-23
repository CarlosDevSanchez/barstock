'use client'

import type { ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarTrigger
} from '@/components/ui/sidebar'
import { toast } from 'sonner'
import { ConnectionStatus } from '@/components/connection-status'
import { apiPatch, apiPost, errorMessage } from '@/lib/api/client'
import { roleAtLeast, type UserRole } from '@/lib/auth/roles'
import { clearOfflineCaches } from '@/lib/pwa/clear-cache'
import { APP_LOCALES, type AppLocale } from '@/lib/i18n/config'
import { useCartStore } from '@/stores/cart'
import type { SettingsWithLogoUrl } from '@/lib/api/settings'
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
    Moon,
    Sun,
    LogOut,
    FolderTree,
    Gift,
    UserCog,
    ChevronRight,
    ScrollText
} from 'lucide-react'
import { cn } from '@/lib/utils'

type NavKey =
    | 'dashboard'
    | 'pos'
    | 'products'
    | 'categories'
    | 'promotions'
    | 'inventory'
    | 'orders'
    | 'customers'
    | 'suppliers'
    | 'reports'
    | 'settings'
    | 'users'
    | 'audit'

interface NavItem {
    icon: typeof LayoutDashboard
    href: string
    minimumRole: UserRole
    key: NavKey
}

interface NavGroup {
    key: 'sales' | 'catalog' | 'analytics' | 'admin'
    items: NavItem[]
}

const navGroups: NavGroup[] = [
    {
        key: 'sales',
        items: [
            { icon: LayoutDashboard, key: 'dashboard', href: '/dashboard', minimumRole: 'cashier' },
            { icon: ShoppingCart, key: 'pos', href: '/pos', minimumRole: 'cashier' },
            { icon: ShoppingBag, key: 'orders', href: '/orders', minimumRole: 'cashier' },
            { icon: Users, key: 'customers', href: '/customers', minimumRole: 'cashier' }
        ]
    },
    {
        key: 'catalog',
        items: [
            { icon: Package, key: 'products', href: '/products', minimumRole: 'cashier' },
            { icon: FolderTree, key: 'categories', href: '/categories', minimumRole: 'cashier' },
            { icon: Gift, key: 'promotions', href: '/promotions', minimumRole: 'manager' },
            { icon: Warehouse, key: 'inventory', href: '/inventory', minimumRole: 'cashier' },
            { icon: Truck, key: 'suppliers', href: '/suppliers', minimumRole: 'manager' }
        ]
    },
    {
        key: 'analytics',
        items: [{ icon: BarChart3, key: 'reports', href: '/reports', minimumRole: 'manager' }]
    },
    {
        key: 'admin',
        items: [
            { icon: Settings2, key: 'settings', href: '/settings', minimumRole: 'admin' },
            { icon: UserCog, key: 'users', href: '/users', minimumRole: 'admin' },
            { icon: ScrollText, key: 'audit', href: '/audit', minimumRole: 'admin' }
        ]
    }
]

interface AppShellProps {
    user: SessionUser
    settings: SettingsWithLogoUrl
    children: ReactNode
    defaultSidebarOpen?: boolean
}

export function AppShell({ user, settings, children, defaultSidebarOpen = true }: AppShellProps) {
    const router = useRouter()
    const pathname = usePathname()
    const { theme, setTheme } = useTheme()
    const tNav = useTranslations('nav')
    const t = useTranslations('common')
    const clearCart = useCartStore(state => state.clearCart)
    const visibleGroups = navGroups
        .map(group => ({ ...group, items: group.items.filter(item => roleAtLeast(user.role, item.minimumRole)) }))
        .filter(group => group.items.length > 0)
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
        // Same reason, for a shared/kiosk device: the offline caches are per-session, not per-device.
        await clearOfflineCaches()
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

    const accountMenu = (
        <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('language')}</DropdownMenuLabel>
            {APP_LOCALES.map(locale => (
                <DropdownMenuItem
                    key={locale}
                    onClick={() => setLocale(locale)}
                    className={cn(user.locale === locale && 'font-medium text-sidebar-primary')}
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
            <SidebarProvider defaultOpen={defaultSidebarOpen} className="print:block">
                <Sidebar collapsible="icon" className="print:hidden">
                    <SidebarHeader>
                        <h1 className="px-2 py-1 text-lg font-bold text-sidebar-primary truncate group-data-[collapsible=icon]:hidden">
                            {settings.store_name}
                        </h1>
                    </SidebarHeader>
                    <SidebarContent>
                        <nav aria-label={tNav('label')}>
                            {visibleGroups.map(group => (
                                <Collapsible key={group.key} defaultOpen className="group/collapsible">
                                    <SidebarGroup>
                                        <SidebarGroupLabel asChild>
                                            <CollapsibleTrigger className="flex w-full items-center justify-between">
                                                {tNav(`groups.${group.key}`)}
                                                <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                                            </CollapsibleTrigger>
                                        </SidebarGroupLabel>
                                        <CollapsibleContent>
                                            <SidebarGroupContent>
                                                <SidebarMenu>
                                                    {group.items.map(item => {
                                                        const Icon = item.icon
                                                        const isActive =
                                                            pathname === item.href ||
                                                            pathname.startsWith(`${item.href}/`)
                                                        return (
                                                            <SidebarMenuItem key={item.href}>
                                                                <SidebarMenuButton
                                                                    asChild
                                                                    isActive={isActive}
                                                                    tooltip={tNav(item.key)}
                                                                >
                                                                    <Link href={item.href}>
                                                                        <Icon />
                                                                        <span>{tNav(item.key)}</span>
                                                                    </Link>
                                                                </SidebarMenuButton>
                                                            </SidebarMenuItem>
                                                        )
                                                    })}
                                                </SidebarMenu>
                                            </SidebarGroupContent>
                                        </CollapsibleContent>
                                    </SidebarGroup>
                                </Collapsible>
                            ))}
                        </nav>
                    </SidebarContent>
                    <SidebarFooter>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="w-full justify-start gap-3 px-2">
                                    <Avatar>
                                        <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground">
                                            {displayName.charAt(0).toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex flex-col items-start text-sm group-data-[collapsible=icon]:hidden">
                                        <span className="font-medium truncate max-w-32">{displayName}</span>
                                        <span className="text-xs text-muted-foreground">{t(`role.${user.role}`)}</span>
                                    </div>
                                </Button>
                            </DropdownMenuTrigger>
                            {accountMenu}
                        </DropdownMenu>
                    </SidebarFooter>
                </Sidebar>

                <SidebarInset className="print:block">
                    <header className="flex items-center gap-3 border-b bg-card p-4 print:hidden">
                        <SidebarTrigger />
                        <h1 className="text-lg font-bold text-sidebar-primary lg:hidden">{settings.store_name}</h1>
                        <div className="ml-auto">
                            <ConnectionStatus />
                        </div>
                    </header>
                    <main className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-900 print:overflow-visible print:p-0 print:bg-white">
                        {children}
                    </main>
                </SidebarInset>
            </SidebarProvider>
        </SessionProvider>
    )
}
