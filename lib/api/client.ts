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
    query?: Query
    signal?: AbortSignal
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
export async function apiList<T, S = undefined>(
    path: string,
    query?: Query,
    signal?: AbortSignal
): Promise<Paginated<T, S>> {
    return (await request('GET', path, { query, signal })) as Paginated<T, S>
}

export async function apiPost<T = void>(path: string, body?: unknown): Promise<T> {
    return ((await request('POST', path, { body })) as Single<T> | undefined)?.data as T
}

export async function apiPatch<T = void>(path: string, body: unknown): Promise<T> {
    return ((await request('PATCH', path, { body })) as Single<T> | undefined)?.data as T
}

/** Most DELETEs carry no body and return 204; a few (e.g. removing a tab line) need a reason and return the updated resource. */
export async function apiDelete<T = void>(path: string, body?: unknown): Promise<T> {
    return ((await request('DELETE', path, { body })) as Single<T> | undefined)?.data as T
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
