/** Page sizes offered by every paginated list (products, categories, inventory, customers, suppliers, orders, users). */
export const PAGE_SIZES = [10, 25, 50] as const
export type PageSize = (typeof PAGE_SIZES)[number]

/**
 * Builds the sequence of page numbers (and `'ellipsis'` markers) a pager shows around the current page, always
 * keeping the first and last page visible, e.g. `1 … 4 5 6 … 20`.
 */
export function pageItems(page: number, pages: number): (number | 'ellipsis')[] {
    if (pages <= 1) return pages < 1 ? [] : [1]

    const current = Math.min(Math.max(page, 1), pages)
    const siblingCount = 1
    // first + last + current + two siblings + the two numbers an ellipsis would otherwise replace.
    const totalNumbers = siblingCount * 2 + 5

    if (pages <= totalNumbers) return Array.from({ length: pages }, (_, index) => index + 1)

    const leftSibling = Math.max(current - siblingCount, 1)
    const rightSibling = Math.min(current + siblingCount, pages)
    const showLeftEllipsis = leftSibling > 2
    const showRightEllipsis = rightSibling < pages - 1

    const items: (number | 'ellipsis')[] = [1]

    if (showLeftEllipsis) {
        items.push('ellipsis')
    } else {
        for (let p = 2; p < leftSibling; p++) items.push(p)
    }

    for (let p = leftSibling; p <= rightSibling; p++) {
        if (p !== 1 && p !== pages) items.push(p)
    }

    if (showRightEllipsis) {
        items.push('ellipsis')
    } else {
        for (let p = rightSibling + 1; p < pages; p++) items.push(p)
    }

    items.push(pages)
    return items
}
