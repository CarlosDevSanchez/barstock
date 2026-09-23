import { afterEach, describe, expect, mock, test } from 'bun:test'
import { IntlProvider } from '../helpers/fixtures'
import { setupDom } from '../helpers/dom'

setupDom()
const { act, cleanup, render, screen } = await import('@testing-library/react')

const toastCalls: Array<{ kind: string; message: string; options?: unknown }> = []
void mock.module('sonner', () => ({
    toast: {
        error: (message: string, options?: unknown) => toastCalls.push({ kind: 'error', message, options }),
        success: (message: string) => toastCalls.push({ kind: 'success', message }),
        dismiss: (id: string) => toastCalls.push({ kind: 'dismiss', message: id })
    }
}))

const { ConnectionStatus } = await import('@/components/connection-status')

afterEach(() => {
    cleanup()
    toastCalls.length = 0
})

const setOnline = (value: boolean) => {
    Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

describe('ConnectionStatus', () => {
    test('renders nothing and shows no toast while online', () => {
        setOnline(true)
        render(
            <IntlProvider>
                <ConnectionStatus />
            </IntlProvider>
        )
        expect(screen.queryByText('Offline')).toBeNull()
        expect(toastCalls).toEqual([])
    })

    test('shows the offline badge and a persistent toast when the connection drops', () => {
        setOnline(true)
        render(
            <IntlProvider>
                <ConnectionStatus />
            </IntlProvider>
        )
        act(() => {
            setOnline(false)
            window.dispatchEvent(new Event('offline'))
        })
        expect(screen.getByText('Offline')).toBeTruthy()
        expect(toastCalls).toEqual([
            { kind: 'error', message: expect.any(String), options: { id: 'connection-offline', duration: Infinity } }
        ])
    })

    test('dismisses the offline toast and shows a success toast on reconnect', () => {
        setOnline(false)
        render(
            <IntlProvider>
                <ConnectionStatus />
            </IntlProvider>
        )
        toastCalls.length = 0
        act(() => {
            setOnline(true)
            window.dispatchEvent(new Event('online'))
        })
        expect(screen.queryByText('Offline')).toBeNull()
        expect(toastCalls).toEqual([
            { kind: 'dismiss', message: 'connection-offline' },
            { kind: 'success', message: expect.any(String) }
        ])
    })
})
