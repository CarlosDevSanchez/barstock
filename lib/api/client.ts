import type { ApiErrorBody, Paginated, Single } from './types'
import { DEFAULT_APP_LOCALE, isAppLocale, type AppLocale } from '@/lib/i18n/config'
import en from '@/messages/en.json'
import es from '@/messages/es.json'

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
    /** Multipart body (image uploads): sent as-is, letting the browser set the multipart boundary Content-Type. */
    formData?: FormData
    query?: Query
    signal?: AbortSignal
    headers?: Record<string, string>
    /** Default true. The offline sync engine (lib/offline/sync.ts) passes false: a 401 there means "pause this
     * entry and try again once there is a session again", not "send the whole tab to /login". */
    redirectOnUnauthorized?: boolean
}

export interface ApiCallOptions {
    headers?: Record<string, string>
    redirectOnUnauthorized?: boolean
}

const BASE = '/api/v1/'
const catalogs = { es, en } as const

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

/** Objects (or arrays) returned from a GET the service worker served out of its cache (`X-From-Cache`, see public/sw.js). */
const staleResponses = new WeakSet<object>()

/** True when `value` (whatever a `useApiQuery` fetcher resolved to) came from the offline cache, not a live request. */
export function isStale(value: unknown): boolean {
    return typeof value === 'object' && value !== null && staleResponses.has(value)
}

async function request(
    method: string,
    path: string,
    { body, formData, query, signal, headers, redirectOnUnauthorized = true }: RequestOptions = {}
): Promise<{ payload: unknown; fromCache: boolean }> {
    let response: Response
    try {
        response = await fetch(buildUrl(path, query), {
            method,
            headers: {
                ...(formData || body === undefined ? undefined : { 'Content-Type': 'application/json' }),
                ...headers
            },
            body: formData ?? (body === undefined ? undefined : JSON.stringify(body)),
            credentials: 'same-origin',
            signal
        })
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        // The message is a translation key (see `errorMessage` below), matched the same way `validation.*` messages are.
        throw new ApiError(0, 'network_offline', 'errors.network_offline')
    }
    const fromCache = response.headers.get('X-From-Cache') === '1'
    if (response.status === 204) return { payload: undefined, fromCache }
    const payload = await readJson(response)
    if (!response.ok) {
        if (response.status === 401 && redirectOnUnauthorized) handleUnauthorized(path)
        throw toApiError(response.status, payload)
    }
    return { payload, fromCache }
}

function markIfStale<T>(value: T, fromCache: boolean): T {
    if (fromCache && typeof value === 'object' && value !== null) staleResponses.add(value)
    return value
}

/** GET a single resource: returns `data` from the `{ data }` envelope. */
export async function apiGet<T>(
    path: string,
    query?: Query,
    signal?: AbortSignal,
    options?: ApiCallOptions
): Promise<T> {
    const { payload, fromCache } = await request('GET', path, { query, signal, ...options })
    return markIfStale((payload as Single<T>).data, fromCache)
}

/** GET a list: returns the whole paginated envelope. */
export async function apiList<T, S = undefined>(
    path: string,
    query?: Query,
    signal?: AbortSignal
): Promise<Paginated<T, S>> {
    const { payload, fromCache } = await request('GET', path, { query, signal })
    return markIfStale(payload as Paginated<T, S>, fromCache)
}

export async function apiPost<T = void>(path: string, body?: unknown, options?: ApiCallOptions): Promise<T> {
    const { payload } = await request('POST', path, { body, ...options })
    return (payload as Single<T> | undefined)?.data as T
}

/** POST a multipart body (image uploads): see `readUploadedFile` on the server. */
export async function apiPostForm<T = void>(path: string, formData: FormData): Promise<T> {
    const { payload } = await request('POST', path, { formData })
    return (payload as Single<T> | undefined)?.data as T
}

export async function apiPatch<T = void>(path: string, body: unknown): Promise<T> {
    const { payload } = await request('PATCH', path, { body })
    return (payload as Single<T> | undefined)?.data as T
}

/** Most DELETEs carry no body and return 204; a few (e.g. removing a tab line) need a reason and return the updated resource. */
export async function apiDelete<T = void>(path: string, body?: unknown): Promise<T> {
    const { payload } = await request('DELETE', path, { body })
    return (payload as Single<T> | undefined)?.data as T
}

function currentLocale(): AppLocale {
    if (typeof document === 'undefined') return DEFAULT_APP_LOCALE
    return isAppLocale(document.documentElement.lang) ? document.documentElement.lang : DEFAULT_APP_LOCALE
}

function translateKey(key: string, locale: AppLocale): string | undefined {
    const parts = key.split('.')
    let node: unknown = catalogs[locale]
    for (const part of parts) {
        if (!node || typeof node !== 'object') return undefined
        node = (node as Record<string, unknown>)[part]
    }
    return typeof node === 'string' ? node : undefined
}

/** A message fit for a toast: translates known keys (`validation.*`); otherwise shows the API text. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
    if (!(error instanceof Error)) return fallback
    const locale = currentLocale()
    if (error instanceof ApiError && Array.isArray(error.details)) {
        const first = error.details[0] as { path?: string; message?: string } | undefined
        if (first?.message) {
            const translated = translateKey(first.message, locale) ?? first.message
            return `${first.path ? `${first.path}: ` : ''}${translated}`
        }
    }
    return translateKey(error.message, locale) ?? (error.message || fallback)
}
