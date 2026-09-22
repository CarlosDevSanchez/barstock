import { useState } from 'react'
import { PAGE_SIZES } from '@/lib/pagination'

export interface UsePaginationResult {
    page: number
    pageSize: number
    setPage: (page: number) => void
    setPageSize: (pageSize: number) => void
    /** Back to page 1, e.g. when a search or filter changes what "page 1" even means. */
    reset: () => void
}

/** Replaces the `useState(1)` + local `PAGE_SIZE` constant every list page used to repeat. */
export function usePagination(): UsePaginationResult {
    const [page, setPage] = useState(1)
    const [pageSize, setPageSizeState] = useState<number>(PAGE_SIZES[0])

    const setPageSize = (next: number) => {
        setPageSizeState(next)
        setPage(1)
    }

    return { page, pageSize, setPage, setPageSize, reset: () => setPage(1) }
}
