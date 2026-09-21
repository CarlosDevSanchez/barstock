/** JSON contract of /api/v1, shared by the Route Handlers and the browser client. */
export interface ApiErrorBody {
    error: { code: string; message: string; details?: unknown }
}

export interface Paginated<T> {
    data: T[]
    page: number
    pageSize: number
    total: number
}

export interface Single<T> {
    data: T
}
