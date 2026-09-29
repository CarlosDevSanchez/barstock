import { afterEach, describe, expect, test } from 'bun:test'
import { settings, userWithRole, IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { act, cleanup, render, screen } = await import('@testing-library/react')

const { CashSessionTimer, formatElapsed, LONG_SESSION_HOURS } = await import('@/components/pos/cash-session-timer')
const { SessionProvider } = await import('@/components/session-provider')

const HOUR = 3_600_000

function renderTimer(openedAt: string) {
    return render(
        <IntlProvider>
            <SessionProvider value={{ user: userWithRole('cashier'), settings }}>
                <CashSessionTimer registerName="Caja 1" openedAt={openedAt} />
            </SessionProvider>
        </IntlProvider>
    )
}

afterEach(cleanup)

describe('formatElapsed', () => {
    test('pads hours, minutes and seconds and keeps counting past a day', () => {
        const opened = '2026-09-28T10:00:00Z'
        const at = (ms: number) => Date.parse(opened) + ms
        expect(formatElapsed(opened, at(0))).toBe('00:00:00')
        expect(formatElapsed(opened, at(2 * HOUR + 5 * 60_000 + 9_000))).toBe('02:05:09')
        expect(formatElapsed(opened, at(26 * HOUR))).toBe('26:00:00')
    })

    test('never shows negative time when the client clock is behind the server', () => {
        expect(formatElapsed('2026-09-28T10:00:00Z', Date.parse('2026-09-28T09:59:00Z'))).toBe('00:00:00')
    })
})

describe('CashSessionTimer', () => {
    test('links to /cash with the till name and the running time', () => {
        renderTimer(new Date(Date.now() - (HOUR + 30_000)).toISOString())
        const link = screen.getByRole('link', { name: /Till Caja 1 open for 01:00:3\d/ })
        expect(link.getAttribute('href')).toBe('/cash')
        expect(link.textContent).toContain('Caja 1')
    })

    test('ticks every second', async () => {
        renderTimer(new Date(Date.now() - 5_000).toISOString())
        const before = screen.getByRole('link').textContent
        await act(() => new Promise(resolve => setTimeout(resolve, 1_100)))
        expect(screen.getByRole('link').textContent).not.toBe(before)
    })

    test('stays neutral on a normal shift', () => {
        renderTimer(new Date(Date.now() - HOUR).toISOString())
        expect(screen.getByRole('link').className).not.toContain('amber')
    })

    test('turns amber once the till has been open too long', () => {
        renderTimer(new Date(Date.now() - LONG_SESSION_HOURS * HOUR - 60_000).toISOString())
        expect(screen.getByRole('link').className).toContain('amber')
    })
})
