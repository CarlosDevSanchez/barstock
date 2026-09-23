'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { MoreHorizontal } from 'lucide-react'
import { useSidebar } from '@/components/ui/sidebar'
import { navGroups, mobileTabKeys, type NavItem } from '@/components/shell/nav-config'
import { cn } from '@/lib/utils'

const allItems = navGroups.flatMap(group => group.items)
const mobileTabs = mobileTabKeys
    .map(key => allItems.find(item => item.key === key))
    .filter((item): item is NavItem => item !== undefined)

function isActive(pathname: string, href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
}

export function BottomNav() {
    const pathname = usePathname()
    const tNav = useTranslations('nav')
    const { setOpenMobile } = useSidebar()
    const isOnTab = mobileTabs.some(item => isActive(pathname, item.href))

    return (
        <nav
            aria-label={tNav('mobileLabel')}
            className="fixed inset-x-0 bottom-0 z-40 h-16 border-t bg-card/95 backdrop-blur lg:hidden print:hidden touch-manipulation"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
            <ul className="grid h-16 grid-cols-5 items-stretch">
                {mobileTabs.map((item, index) => {
                    const Icon = item.icon
                    const active = isActive(pathname, item.href)
                    const isCenter = index === Math.floor(mobileTabs.length / 2)
                    return (
                        <li key={item.href} className="flex">
                            <Link
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={cn(
                                    'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]',
                                    active ? 'text-primary' : 'text-muted-foreground'
                                )}
                            >
                                {isCenter ? (
                                    <span
                                        className={cn(
                                            'flex size-10 items-center justify-center rounded-full',
                                            active
                                                ? 'bg-primary text-primary-foreground'
                                                : 'bg-primary/90 text-primary-foreground'
                                        )}
                                    >
                                        <Icon className="size-5" />
                                    </span>
                                ) : (
                                    <Icon className="size-5" />
                                )}
                                <span>{tNav(item.key)}</span>
                            </Link>
                        </li>
                    )
                })}
                <li className="flex">
                    <button
                        type="button"
                        onClick={() => setOpenMobile(true)}
                        aria-current={!isOnTab ? 'page' : undefined}
                        className={cn(
                            'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]',
                            !isOnTab ? 'text-primary' : 'text-muted-foreground'
                        )}
                    >
                        <MoreHorizontal className="size-5" />
                        <span>{tNav('more')}</span>
                    </button>
                </li>
            </ul>
        </nav>
    )
}
