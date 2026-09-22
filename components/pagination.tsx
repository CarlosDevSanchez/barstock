import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PaginationProps {
    page: number
    pageSize: number
    total: number
    onPageChange: (page: number) => void
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
    const pages = Math.max(1, Math.ceil(total / pageSize))
    if (total <= pageSize) return null
    return (
        <div className="flex items-center justify-between pt-4 text-sm text-muted-foreground">
            <span>
                Page {page} of {pages} · {total} results
            </span>
            <div className="flex gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => onPageChange(page - 1)}
                    aria-label="Previous page"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pages}
                    onClick={() => onPageChange(page + 1)}
                    aria-label="Next page"
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
