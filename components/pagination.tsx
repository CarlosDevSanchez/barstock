'use client'

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PAGE_SIZES, pageItems } from '@/lib/pagination'

interface PaginationProps {
    page: number
    pageSize: number
    total: number
    onPageChange: (page: number) => void
    onPageSizeChange: (pageSize: number) => void
}

/** Reusable pager for every list page: always visible, page-size select, translated (`pagination` namespace). */
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: PaginationProps) {
    const t = useTranslations('pagination')
    const pages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(Math.max(page, 1), pages)
    const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
    const to = Math.min(currentPage * pageSize, total)
    const items = pageItems(currentPage, pages)

    return (
        <div className="flex flex-col gap-4 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span>{t('showing', { from, to, total })}</span>
                <div className="flex items-center gap-2">
                    <span>{t('rowsPerPage')}</span>
                    <Select value={String(pageSize)} onValueChange={value => onPageSizeChange(Number(value))}>
                        <SelectTrigger className="h-8 w-[70px]" size="sm" aria-label={t('rowsPerPageAria')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PAGE_SIZES.map(size => (
                                <SelectItem key={size} value={String(size)}>
                                    {size}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="flex items-center gap-1">
                <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={currentPage <= 1}
                    onClick={() => onPageChange(1)}
                    aria-label={t('firstPage')}
                >
                    <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={currentPage <= 1}
                    onClick={() => onPageChange(currentPage - 1)}
                    aria-label={t('previousPage')}
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                {/* Numbers add noise on narrow screens; the arrows above already cover navigation there. */}
                <div className="hidden items-center gap-1 sm:flex" data-testid="page-numbers">
                    {items.map((item, index) =>
                        item === 'ellipsis' ? (
                            <span key={`ellipsis-${index}`} className="px-1 text-muted-foreground">
                                &hellip;
                            </span>
                        ) : (
                            <Button
                                key={item}
                                variant={item === currentPage ? 'default' : 'outline'}
                                size="icon-sm"
                                aria-label={t('pageAria', { page: item })}
                                aria-current={item === currentPage ? 'page' : undefined}
                                onClick={() => onPageChange(item)}
                            >
                                {item}
                            </Button>
                        )
                    )}
                </div>
                <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={currentPage >= pages}
                    onClick={() => onPageChange(currentPage + 1)}
                    aria-label={t('nextPage')}
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={currentPage >= pages}
                    onClick={() => onPageChange(pages)}
                    aria-label={t('lastPage')}
                >
                    <ChevronsRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
