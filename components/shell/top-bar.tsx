'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { ConnectionStatus } from '@/components/connection-status'
import { AccountMenu } from '@/components/shell/account-menu'
import { findNavItem } from '@/components/shell/nav-config'
import type { SessionUser } from '@/components/session-provider'

const DETAIL_ROUTE_PREFIXES = ['/orders/', '/customers/']

interface TopBarProps {
    user: SessionUser
    storeName: string
}

export function TopBar({ user, storeName }: TopBarProps) {
    const pathname = usePathname()
    const router = useRouter()
    const tNav = useTranslations('nav')
    const navItem = findNavItem(pathname)
    const isDetailRoute = DETAIL_ROUTE_PREFIXES.some(
        prefix => pathname.startsWith(prefix) && pathname !== prefix.slice(0, -1)
    )

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
                <ConnectionStatus />
                <AccountMenu user={user} />
            </div>
        </header>
    )
}
