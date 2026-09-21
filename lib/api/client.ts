import type { ApiErrorBody, Paginated, Single } from './types'

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly details?: unknown
    ) {
        super(message)
        this.name = 'ApiError'
    }
}

type QueryValue = string | number | boolean | null | undefined
export type Query = Record<string, QueryValue>

interface RequestOptions {
    body?: unknown
    query?: Query
    signal?: AbortSignal
}

const BASE = '/api/v1/'

function buildUrl(path: string, query?: Query): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== null && value !== undefined && value !== '') search.set(key, String(value))
    }
    const qs = search.toString()
    return `${BASE}${path}${qs ? `?${qs}` : ''}`
}

async function readJson(response: Response): Promise<unknown> {
    try {
        return await response.json()
    } catch {
        return undefined
    }
}

function toApiError(status: number, payload: unknown): ApiError {
    const error = (payload as Partial<ApiErrorBody> | undefined)?.error
    return new ApiError(
        status,
        error?.code ?? 'unknown_error',
        error?.message ?? `Request failed (${status})`,
        error?.details
    )
}

/** Sends the user to /login when the session is gone (except for the auth endpoints themselves, where 401 means "bad credentials"). */
function handleUnauthorized(path: string) {
    if (typeof window === 'undefined' || path.startsWith('auth/')) return
    const next = window.location.pathname + window.location.search
    // A full navigation is intentional: it discards in-memory client state (cart, auth store) tied to the dead session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(next)}`)
}

async function request(method: string, path: string, { body, query, signal }: RequestOptions = {}): Promise<unknown> {
    const response = await fetch(buildUrl(path, query), {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        signal
    })
    if (response.status === 204) return undefined
    const payload = await readJson(response)
    if (!response.ok) {
        if (response.status === 401) handleUnauthorized(path)
        throw toApiError(response.status, payload)
    }
    return payload
}

/** GET a single resource: returns `data` from the `{ data }` envelope. */
export async function apiGet<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
    return ((await request('GET', path, { query, signal })) as Single<T>).data
}

/** GET a list: returns the whole paginated envelope. */
export async function apiList<T>(path: string, query?: Query, signal?: AbortSignal): Promise<Paginated<T>> {
    return (await request('GET', path, { query, signal })) as Paginated<T>
}

export async function apiPost<T = void>(path: string, body?: unknown): Promise<T> {
    return ((await request('POST', path, { body })) as Single<T> | undefined)?.data as T
}

export async function apiPatch<T = void>(path: string, body: unknown): Promise<T> {
    return ((await request('PATCH', path, { body })) as Single<T> | undefined)?.data as T
}

export async function apiDelete(path: string): Promise<void> {
    await request('DELETE', path)
}
