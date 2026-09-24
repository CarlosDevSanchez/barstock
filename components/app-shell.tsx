'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
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
    useSidebar
} from '@/components/ui/sidebar'
import { roleAtLeast } from '@/lib/auth/roles'
import { navGroups } from '@/components/shell/nav-config'
import { AccountMenu } from '@/components/shell/account-menu'
import { TopBar } from '@/components/shell/top-bar'
import { BottomNav } from '@/components/shell/bottom-nav'
import type { SettingsWithLogoUrl } from '@/lib/api/settings'
import { SessionProvider, type SessionUser } from '@/components/session-provider'
import { BarstockIcon } from '@/components/branding/barstock-mark'
import { useOutboxSync } from '@/hooks/use-outbox-sync'
import { ChevronRight } from 'lucide-react'

interface AppShellProps {
    user: SessionUser
    settings: SettingsWithLogoUrl
    children: ReactNode
    defaultSidebarOpen?: boolean
}

function SidebarNav({ user }: { user: SessionUser }) {
    const pathname = usePathname()
    const tNav = useTranslations('nav')
    const { setOpenMobile } = useSidebar()
    const visibleGroups = navGroups
        .map(group => ({ ...group, items: group.items.filter(item => roleAtLeast(user.role, item.minimumRole)) }))
        .filter(group => group.items.length > 0)

    return (
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
                                        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                                        return (
                                            <SidebarMenuItem key={item.href}>
                                                <SidebarMenuButton asChild isActive={isActive} tooltip={tNav(item.key)}>
                                                    <Link href={item.href} onClick={() => setOpenMobile(false)}>
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
    )
}

export function AppShell({ user, settings, children, defaultSidebarOpen = true }: AppShellProps) {
    // Keeps sending queued offline sales (F3) no matter which page is open; the counter/sheet (F4) live in TopBar.
    const { pendingCount, syncNow } = useOutboxSync()

    return (
        <SessionProvider value={{ user, settings }}>
            <SidebarProvider defaultOpen={defaultSidebarOpen} className="print:block">
                <Sidebar collapsible="icon" className="print:hidden">
                    <SidebarHeader>
                        <div className="flex items-center gap-2 px-2 py-1">
                            <BarstockIcon className="size-7 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                                <span className="block text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
                                    Barstock
                                </span>
                                <span
                                    data-testid="store-name"
                                    className="block truncate text-lg font-bold text-sidebar-primary leading-tight"
                                >
                                    {settings.store_name}
                                </span>
                            </div>
                        </div>
                    </SidebarHeader>
                    <SidebarContent>
                        <SidebarNav user={user} />
                    </SidebarContent>
                    <SidebarFooter>
                        <AccountMenu user={user} variant="full" />
                    </SidebarFooter>
                </Sidebar>

                <SidebarInset className="print:block">
                    <TopBar
                        user={user}
                        storeName={settings.store_name}
                        pendingOutboxCount={pendingCount}
                        onSyncNow={syncNow}
                    />
                    <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-slate-50 dark:bg-slate-900 px-4 py-4 sm:px-6 sm:py-6 pb-[calc(4rem+env(safe-area-inset-bottom)+1rem)] lg:pb-6 print:overflow-visible print:p-0 print:bg-white">
                        <div className="mx-auto w-full max-w-7xl">{children}</div>
                    </main>
                    <BottomNav />
                </SidebarInset>
            </SidebarProvider>
        </SessionProvider>
    )
}
