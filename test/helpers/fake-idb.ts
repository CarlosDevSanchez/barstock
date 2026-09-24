/**
 * A shared in-memory stand-in for lib/offline/db.ts's IndexedDB wrapper, used by any lib/offline/*.test.ts file
 * that needs `@/lib/offline/db` mocked. Bun's `mock.module` is process-global (test:unit runs every lib/**
 * file in one process), so two test files independently mocking the same module can otherwise stomp on each
 * other depending on load order. Importing this ONE shared instance from every such file, and resetting it in
 * each file's own `beforeEach`, makes the outcome the same no matter which file's `mock.module` call wins.
 */
const stores = new Map<string, Map<string, unknown>>()

export function fakeIdbStore(name: string): Map<string, unknown> {
    let store = stores.get(name)
    if (!store) {
        store = new Map()
        stores.set(name, store)
    }
    return store
}

export function resetFakeIdb(): void {
    stores.clear()
}
