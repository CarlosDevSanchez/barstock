import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { act, cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react')

const { InstallBanner } = await import('@/components/pwa/install-banner')

const DISMISS_KEY = 'barstock-pwa-install-dismissed'

function stubMatchMedia(standalone: boolean) {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: (query: string) => ({
            matches: query === '(display-mode: standalone)' ? standalone : false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false
        })
    })
}

function stubUserAgent(ua: string, opts?: { platform?: string; maxTouchPoints?: number }) {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua })
    Object.defineProperty(navigator, 'platform', { configurable: true, value: opts?.platform ?? 'Win32' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: opts?.maxTouchPoints ?? 0 })
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: false })
}

beforeEach(() => {
    localStorage.removeItem(DISMISS_KEY)
    stubMatchMedia(false)
    stubUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0')
})

afterEach(() => {
    cleanup()
    localStorage.removeItem(DISMISS_KEY)
})

describe('InstallBanner', () => {
    test('renders nothing when already running as a standalone PWA', async () => {
        stubMatchMedia(true)
        render(
            <IntlProvider>
                <InstallBanner />
            </IntlProvider>
        )
        await act(async () => {})
        expect(screen.queryByText('Install Barstock')).toBeNull()
    })

    test('shows the Install button after beforeinstallprompt and hides on dismiss', async () => {
        render(
            <IntlProvider>
                <InstallBanner />
            </IntlProvider>
        )

        await act(async () => {
            const event = new Event('beforeinstallprompt') as Event & {
                preventDefault: () => void
                prompt: () => Promise<void>
                userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
            }
            event.preventDefault = () => {}
            event.prompt = async () => {}
            event.userChoice = Promise.resolve({ outcome: 'dismissed' })
            window.dispatchEvent(event)
        })

        await waitFor(() => expect(screen.getByText('Install Barstock')).toBeTruthy())
        expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss install notice' }))
        expect(screen.queryByText('Install Barstock')).toBeNull()
        expect(localStorage.getItem(DISMISS_KEY)).toBe('1')
    })

    test('shows iOS install steps when on iPhone Safari without the install API', async () => {
        stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', {
            platform: 'iPhone'
        })
        render(
            <IntlProvider>
                <InstallBanner />
            </IntlProvider>
        )

        await waitFor(() => expect(screen.getByText('Install Barstock')).toBeTruthy())
        fireEvent.click(screen.getByRole('button', { name: 'How to install' }))
        expect(screen.getByText('Tap the Share button in Safari.')).toBeTruthy()
        expect(screen.getByText('Choose “Add to Home Screen”.')).toBeTruthy()
    })
})
