import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * Registers happy-dom for THIS process. Component test files each run in their own `bun test` process (see the `test:components`
 * script): Testing Library captures `document` when it is first imported, and a `window` left behind would change how
 * unrelated tests behave.
 */
export function setupDom(): void {
    GlobalRegistrator.register({ url: 'http://localhost:3000' })
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

    // Radix UI relies on browser APIs happy-dom does not implement.
    class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    Object.assign(globalThis, { ResizeObserver: ResizeObserverStub })
    Object.assign(window.HTMLElement.prototype, {
        scrollIntoView: () => {},
        hasPointerCapture: () => false,
        releasePointerCapture: () => {},
        setPointerCapture: () => {}
    })
}
