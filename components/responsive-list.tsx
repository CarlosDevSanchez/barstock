import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight, MoreVertical } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface ResponsiveListProps<T> {
    items: T[]
    keyOf: (item: T) => string | number
    /** The existing `<Table>…</Table>` markup, shown unchanged on `md+`. */
    table: ReactNode
    renderCard: (item: T) => ReactNode
    className?: string
}

/** Renders `table` on `md+` and a card list (one row per item) below it. Nothing about the table changes. */
export function ResponsiveList<T>({ items, keyOf, table, renderCard, className }: ResponsiveListProps<T>) {
    return (
        <>
            <div className="hidden md:block">{table}</div>
            <Card className={cn('divide-y py-0 md:hidden', className)}>
                {items.map(item => (
                    <div key={keyOf(item)}>{renderCard(item)}</div>
                ))}
            </Card>
        </>
    )
}

interface ListCardRowProps {
    title: ReactNode
    subtitle?: ReactNode
    value?: ReactNode
    href?: string
    onClick?: () => void
    menu?: ReactNode
}

/** A touch-friendly (min 56px) row for use inside `renderCard`: title, subtitle, a right-aligned value, and either a
 *  `›` (when the row navigates) or a `…` dropdown (when it has secondary actions). */
export function ListCardRow({ title, subtitle, value, href, onClick, menu }: ListCardRowProps) {
    const navigable = Boolean(href || onClick)
    const content = (
        <div className="flex min-h-14 items-center gap-3 px-4 py-3 touch-manipulation">
            <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{title}</div>
                {subtitle && <div className="truncate text-sm text-muted-foreground">{subtitle}</div>}
            </div>
            {value && <div className="shrink-0 text-sm">{value}</div>}
            {navigable && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
            {menu && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 shrink-0"
                            aria-label="…"
                            onClick={event => event.stopPropagation()}
                        >
                            <MoreVertical className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    )

    if (href) {
        return (
            <Link href={href} className="block">
                {content}
            </Link>
        )
    }

    if (onClick) {
        return (
            <button type="button" onClick={onClick} className="block w-full text-left">
                {content}
            </button>
        )
    }

    return content
}
