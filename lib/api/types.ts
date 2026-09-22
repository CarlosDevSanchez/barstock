/** JSON contract of /api/v1, shared by the Route Handlers and the browser client. */
export interface ApiErrorBody {
    error: { code: string; message: string; details?: unknown }
}

export interface Paginated<T, S = undefined> {
    data: T[]
    page: number
    pageSize: number
    total: number
    /** Totals computed over the whole filtered set (a page alone cannot provide them). */
    summary?: S
}

export interface Single<T> {
    data: T
}
