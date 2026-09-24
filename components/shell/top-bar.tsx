'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Bell, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { ConnectionStatus } from '@/components/connection-status'
import { SyncCenter } from '@/components/offline/sync-center'
import { AccountMenu } from '@/components/shell/account-menu'
import { findNavItem } from '@/components/shell/nav-config'
import type { SessionUser } from '@/components/session-provider'
import { inventoryApi } from '@/lib/api/inventory'
import { useApiQuery } from '@/hooks/use-api-query'
import { cn } from '@/lib/utils'

const DETAIL_ROUTE_PREFIXES = ['/orders/', '/customers/']

interface TopBarProps {
    user: SessionUser
    storeName: string
    pendingOutboxCount: number
    onSyncNow: () => void
}

export function TopBar({ user, storeName, pendingOutboxCount, onSyncNow }: TopBarProps) {
    const pathname = usePathname()
    const router = useRouter()
    const tNav = useTranslations('nav')
    const tn = useTranslations('notifications')
    const navItem = findNavItem(pathname)
    const isDetailRoute = DETAIL_ROUTE_PREFIXES.some(
        prefix => pathname.startsWith(prefix) && pathname !== prefix.slice(0, -1)
    )
    const lowStock = useApiQuery(
        signal => inventoryApi.list({ page: 1, pageSize: 1, low: true }, signal),
        'topbar-low-stock'
    )
    const lowCount = lowStock.data?.summary?.low_stock_count ?? 0

    return (
        <header
            className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur print:hidden"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
            <div className="hidden lg:flex">
                <SidebarTrigger aria-label={tNav('toggle')} />
            </div>
            <div className="flex lg:hidden">
                {isDetailRoute ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 -ml-2"
                        aria-label={tNav('back')}
                        onClick={() => router.back()}
                    >
                        <ChevronLeft className="size-5" />
                    </Button>
                ) : (
                    <span className="truncate text-sm font-bold text-sidebar-primary">{storeName}</span>
                )}
            </div>
            <h1 className="truncate text-sm font-semibold lg:hidden">{navItem ? tNav(navItem.key) : ''}</h1>
            <div className="ml-auto flex items-center gap-3">
                <Button variant="ghost" size="icon" className="relative size-9" asChild aria-label={tn('bell')}>
                    <Link href="/inventory?low=1" title={tn('bellCount', { count: lowCount })}>
                        <Bell className="size-5" />
                        <span
                            className={cn(
                                'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                                lowCount > 0
                                    ? 'bg-destructive text-destructive-foreground'
                                    : 'bg-muted text-muted-foreground'
                            )}
                        >
                            {lowCount > 99 ? '99+' : lowCount}
                        </span>
                    </Link>
                </Button>
                <SyncCenter pendingCount={pendingOutboxCount} onSyncNow={onSyncNow} />
                <ConnectionStatus />
                <AccountMenu user={user} />
            </div>
        </header>
    )
}
