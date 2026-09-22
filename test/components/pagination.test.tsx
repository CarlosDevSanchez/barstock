import { afterEach, describe, expect, mock, test } from 'bun:test'
import { IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { cleanup, fireEvent, render, screen, within } = await import('@testing-library/react')

const { Pagination } = await import('@/components/pagination')

afterEach(cleanup)

const renderPagination = (props: Partial<React.ComponentProps<typeof Pagination>> = {}) => {
    const onPageChange = mock((_page: number) => {})
    const onPageSizeChange = mock((_pageSize: number) => {})
    render(
        <IntlProvider>
            <Pagination
                page={1}
                pageSize={10}
                total={100}
                onPageChange={onPageChange}
                onPageSizeChange={onPageSizeChange}
                {...props}
            />
        </IntlProvider>
    )
    return { onPageChange, onPageSizeChange }
}

describe('Pagination', () => {
    test('stays visible and shows the range even with a single page', () => {
        renderPagination({ page: 1, pageSize: 10, total: 3 })
        expect(screen.getByText('Showing 1–3 of 3')).toBeTruthy()
        expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
        expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    })

    test('shows the current range and page numbers with the active one marked aria-current', () => {
        renderPagination({ page: 2, pageSize: 10, total: 25 })
        expect(screen.getByText('Showing 11–20 of 25')).toBeTruthy()

        const pageTwo = screen.getByRole('button', { name: 'Page 2' })
        expect(pageTwo.getAttribute('aria-current')).toBe('page')
        const pageOne = screen.getByRole('button', { name: 'Page 1' })
        expect(pageOne.getAttribute('aria-current')).toBeNull()
    })

    test('clicking a page number, previous/next and first/last calls onPageChange with the right page', () => {
        const { onPageChange } = renderPagination({ page: 3, pageSize: 10, total: 100 })

        fireEvent.click(screen.getByRole('button', { name: 'Page 2' }))
        expect(onPageChange).toHaveBeenLastCalledWith(2)

        fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
        expect(onPageChange).toHaveBeenLastCalledWith(4)

        fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
        expect(onPageChange).toHaveBeenLastCalledWith(2)

        fireEvent.click(screen.getByRole('button', { name: 'First page' }))
        expect(onPageChange).toHaveBeenLastCalledWith(1)

        fireEvent.click(screen.getByRole('button', { name: 'Last page' }))
        expect(onPageChange).toHaveBeenLastCalledWith(10)
    })

    test('changing the page size calls onPageSizeChange with the chosen value', async () => {
        const { onPageSizeChange } = renderPagination({ page: 1, pageSize: 10, total: 100 })

        fireEvent.click(screen.getByRole('combobox', { name: 'Rows per page' }))
        const listbox = await screen.findByRole('listbox')
        fireEvent.click(within(listbox).getByText('50'))

        expect(onPageSizeChange).toHaveBeenCalledWith(50)
    })

    test('the page-number list is hidden on narrow screens via responsive classes, arrows stay visible', () => {
        renderPagination({ page: 1, pageSize: 10, total: 100 })
        const numbers = screen.getByTestId('page-numbers')
        expect(numbers.className).toContain('hidden')
        expect(numbers.className).toContain('sm:flex')
        // The navigation arrows are not inside the numbers wrapper, so they stay visible at any width.
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy()
    })
})
