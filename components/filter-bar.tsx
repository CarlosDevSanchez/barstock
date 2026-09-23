'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Search, SlidersHorizontal } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

interface FilterBarProps {
    search: string
    onSearchChange: (value: string) => void
    searchPlaceholder?: string
    /** Secondary filter controls: inline on desktop, inside a bottom sheet on mobile. */
    children?: ReactNode
    /** Number of non-default filters currently applied, shown as a badge on the "Filtros" trigger. */
    activeCount?: number
}

/** Search input + secondary filters, collapsed into a bottom sheet on mobile. Used by audit, orders, inventory and reports. */
export function FilterBar({ search, onSearchChange, searchPlaceholder, children, activeCount = 0 }: FilterBarProps) {
    const t = useTranslations('common')
    const [open, setOpen] = useState(false)

    return (
        <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={search}
                    onChange={event => onSearchChange(event.target.value)}
                    placeholder={searchPlaceholder ?? t('search')}
                    className="pl-9"
                />
            </div>
            {children && (
                <>
                    <div className="hidden flex-wrap items-center gap-3 lg:flex">{children}</div>
                    <Button
                        variant="outline"
                        className="relative lg:hidden"
                        onClick={() => setOpen(true)}
                        aria-label={t('filters')}
                    >
                        <SlidersHorizontal className="mr-2 size-4" />
                        {t('filters')}
                        {activeCount > 0 && (
                            <Badge className="ml-2 size-5 rounded-full p-0 justify-center">{activeCount}</Badge>
                        )}
                    </Button>
                    <Sheet open={open} onOpenChange={setOpen}>
                        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
                            <SheetHeader>
                                <SheetTitle>{t('filters')}</SheetTitle>
                            </SheetHeader>
                            <div className="flex flex-col gap-4 px-4 pb-6">{children}</div>
                        </SheetContent>
                    </Sheet>
                </>
            )}
        </div>
    )
}
