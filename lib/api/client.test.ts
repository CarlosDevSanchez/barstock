import { afterEach, describe, expect, mock, test } from 'bun:test'
import { ApiError, apiDelete, apiGet, apiList, apiPatch, apiPost } from './client'

const realFetch = globalThis.fetch
const calls: Array<{ url: string; init: RequestInit }> = []

function respond(status: number, body?: unknown) {
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} })
        return new Response(body === undefined ? null : JSON.stringify(body), { status })
    }) as unknown as typeof fetch
}

afterEach(() => {
    globalThis.fetch = realFetch
    calls.length = 0
})

describe('api client', () => {
    test('GET unwraps { data } and builds the query, skipping blank values', async () => {
        respond(200, { data: { id: 1 } })
        expect(
            await apiGet<{ id: number }>('products/1', {
                q: 'beer',
                page: 2,
                empty: '',
                none: null,
                missing: undefined
            })
        ).toEqual({
            id: 1
        })
        expect(calls[0]?.url).toBe('/api/v1/products/1?q=beer&page=2')
        expect(calls[0]?.init.method).toBe('GET')
        expect(calls[0]?.init.credentials).toBe('same-origin')
    })
    test('apiList returns the paginated envelope', async () => {
        const envelope = { data: [1], page: 1, pageSize: 25, total: 1 }
        respond(200, envelope)
        expect(await apiList('products')).toEqual(envelope)
    })
    test('POST and PATCH send JSON', async () => {
        respond(201, { data: { id: 'x' } })
        expect(await apiPost<{ id: string }>('sales', { a: 1 })).toEqual({ id: 'x' })
        expect(calls[0]?.init.body).toBe('{"a":1}')
        expect((calls[0]?.init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
        calls.length = 0
        respond(200, { data: { ok: true } })
        expect(await apiPatch<{ ok: boolean }>('settings', { b: 2 })).toEqual({ ok: true })
        expect(calls[0]?.init.method).toBe('PATCH')
    })
    test('204 resolves to undefined (DELETE)', async () => {
        respond(204)
        await expect(apiDelete('products/1')).resolves.toBeUndefined()
        expect(calls[0]?.init.method).toBe('DELETE')
    })
    test('errors become ApiError with code, message and details', async () => {
        respond(422, {
            error: {
                code: 'validation_failed',
                message: 'The request is not valid',
                details: [{ path: 'name', message: 'Required' }]
            }
        })
        const error = await apiPost('products', {}).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(ApiError)
        expect(error).toMatchObject({
            status: 422,
            code: 'validation_failed',
            details: [{ path: 'name', message: 'Required' }]
        })
    })
    test('non-JSON error bodies still produce an ApiError', async () => {
        globalThis.fetch = mock(
            async () => new Response('<html>bad gateway</html>', { status: 502 })
        ) as unknown as typeof fetch
        const error = await apiGet('me').catch((e: unknown) => e)
        expect(error).toMatchObject({ status: 502, code: 'unknown_error' })
    })
})
