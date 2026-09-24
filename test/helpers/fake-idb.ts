/**
 * A shared in-memory stand-in for lib/offline/db.ts's IndexedDB wrapper, used by outbox.test.ts and sync.test.ts.
 * Bun's `mock.module` is process-global (test:unit runs every lib/** file in one process), so those two files
 * import this ONE shared instance and reset it in each file's own `beforeEach`, so the outcome is the same no
 * matter which file's `mock.module` call wins. lib/offline/db.test.ts is deliberately NOT in that process — it
 * needs the real module's no-indexedDB path (see test:unit / test:coverage path-ignore).
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

/**
 * The full `@/lib/offline/db` surface, backed by the store above — pass this directly to `mock.module` from any
 * `lib/offline/*.test.ts` file. Centralized (rather than each file re-listing the functions it happens to need) so
 * a function added to the real module later can't silently go missing from one file's copy while the other's
 * `mock.module` call is the one that wins the process-global race: a missing export throws for whichever OTHER
 * file (mocked or not) tries to import it next, which is exactly the failure this file's docstring describes.
 */
export function fakeIdbModule() {
    return {
        idbGet: async (store: string, key: string) => fakeIdbStore(store).get(key),
        idbSet: async (store: string, key: string, value: unknown) => {
            fakeIdbStore(store).set(key, value)
        },
        idbGetAll: async (store: string) => [...fakeIdbStore(store).values()],
        idbDelete: async (store: string, key: string) => {
            fakeIdbStore(store).delete(key)
        },
        idbClearSnapshot: async () => {
            fakeIdbStore('snapshot').clear()
        }
    }
}
