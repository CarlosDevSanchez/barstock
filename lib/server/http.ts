import 'server-only'
import { z } from 'zod'
import type { UserRole } from '@/lib/auth/roles'
import type { ApiErrorBody } from '@/lib/api/types'
import { requireRole } from './auth'
import { AppError, badRequest, forbidden, fromDatabaseError, isDatabaseError } from './errors'
import { createSupabaseServerClient, type AppSupabaseClient } from './supabase'
import type { SessionUser } from './auth'

/** A handler's successful outcome. Errors are thrown (AppError, a database `{ error }`, or a ZodError). */
export class ApiResult {
    constructor(
        readonly status: number,
        readonly body?: unknown
    ) {}
}
export const ok = <T>(data: T) => new ApiResult(200, { data })
export const created = <T>(data: T) => new ApiResult(201, { data })
export const noContent = () => new ApiResult(204)
export const paginated = <T>(
    data: T[],
    meta: { page: number; pageSize: number; total: number },
    summary?: Record<string, unknown>
) => new ApiResult(200, { data, ...meta, ...(summary ? { summary } : {}) })

type Out<T> = T extends z.ZodType ? z.output<T> : undefined

export interface RouteContext {
    params: Promise<Record<string, string | string[] | undefined>>
}

interface HandlerArgs<TBody, TQuery, TParams, TUser> {
    request: Request
    user: TUser
    supabase: AppSupabaseClient
    body: TBody
    query: TQuery
    params: TParams
}

interface Schemas<TBody, TQuery, TParams> {
    body?: TBody
    query?: TQuery
    params?: TParams
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export function toErrorResponse(error: unknown): Response {
    let appError: AppError
    if (error instanceof AppError) {
        appError = error
    } else if (error instanceof z.ZodError) {
        appError = new AppError(
            'validation_failed',
            'The request is not valid',
            error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
        )
    } else if (isDatabaseError(error)) {
        appError = fromDatabaseError(error)
    } else {
        appError = new AppError('internal_error', 'Unexpected error')
    }
    if (appError.code === 'internal_error') console.error('[api] unexpected error', error)

    const body: ApiErrorBody = {
        error: { code: appError.code, message: appError.message, details: appError.details }
    }
    return Response.json(body, { status: appError.status, headers: NO_STORE })
}

export function toResponse(result: ApiResult | Response): Response {
    if (result instanceof Response) return result
    if (result.body === undefined) return new Response(null, { status: result.status, headers: NO_STORE })
    return Response.json(result.body, { status: result.status, headers: NO_STORE })
}

/**
 * Reads a single uploaded file from a `multipart/form-data` body (the product/logo image endpoints, which cannot
 * use `route()`'s JSON `body` schema). Never trusts the field's filename or the browser-supplied Content-Type:
 * callers must still run the bytes through `validateImage` (lib/server/storage.ts).
 */
export async function readUploadedFile(request: Request, field = 'file'): Promise<Uint8Array> {
    let form: FormData
    try {
        form = await request.formData()
    } catch {
        throw badRequest('Malformed multipart body')
    }
    const file = form.get(field)
    if (!(file instanceof File)) throw badRequest('Missing file')
    return new Uint8Array(await file.arrayBuffer())
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defense for cookie sessions: browsers always send `Origin` on cross-site writes, so a write whose Origin does not
 * match the host being served is rejected. Requests without Origin (non-browser clients) are allowed: they carry no ambient cookies.
 */
function assertSameOrigin(request: Request) {
    if (SAFE_METHODS.has(request.method)) return
    const origin = request.headers.get('origin')
    if (!origin) return
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    let originHost: string | null = null
    try {
        originHost = new URL(origin).host
    } catch {
        // malformed Origin: rejected below
    }
    if (originHost === null || originHost !== host) throw forbidden('Cross-origin request rejected')
}

async function parseInputs<TBody, TQuery, TParams>(
    request: Request,
    context: RouteContext | undefined,
    schemas: Schemas<TBody, TQuery, TParams>
) {
    let body: unknown
    if (schemas.body) {
        let json: unknown
        try {
            json = await request.json()
        } catch {
            throw badRequest('Malformed JSON body')
        }
        body = schemas.body instanceof z.ZodType ? schemas.body.parse(json) : json
    }
    const query =
        schemas.query instanceof z.ZodType
            ? schemas.query.parse(Object.fromEntries(new URL(request.url).searchParams))
            : undefined
    const params = schemas.params instanceof z.ZodType ? schemas.params.parse(await context?.params) : undefined
    return { body: body as Out<TBody>, query: query as Out<TQuery>, params: params as Out<TParams> }
}

type ZodOrNone = z.ZodType | undefined

interface RouteOptions<TBody extends ZodOrNone, TQuery extends ZodOrNone, TParams extends ZodOrNone> extends Schemas<
    TBody,
    TQuery,
    TParams
> {
    /** Minimum role. Roles are hierarchical (admin ≥ manager ≥ cashier). */
    role: UserRole
    handler: (args: HandlerArgs<Out<TBody>, Out<TQuery>, Out<TParams>, SessionUser>) => Promise<ApiResult | Response>
}

/**
 * Wraps an authenticated Route Handler: same-origin check → session and role → zod validation of body/query/params →
 * handler → JSON envelope. Every failure becomes `{ error: { code, message, details? } }` with the right status.
 * The handler receives a user-scoped Supabase client, so RLS still applies on top of the role check.
 */
export function route<
    TBody extends ZodOrNone = undefined,
    TQuery extends ZodOrNone = undefined,
    TParams extends ZodOrNone = undefined
>(options: RouteOptions<TBody, TQuery, TParams>) {
    return async (request: Request, context?: RouteContext): Promise<Response> => {
        try {
            assertSameOrigin(request)
            const session = await requireRole(options.role)
            const inputs = await parseInputs(request, context, options)
            return toResponse(
                await options.handler({ request, user: session.user, supabase: session.supabase, ...inputs })
            )
        } catch (error) {
            return toErrorResponse(error)
        }
    }
}

interface PublicRouteOptions<TBody extends ZodOrNone, TQuery extends ZodOrNone> extends Schemas<
    TBody,
    TQuery,
    undefined
> {
    handler: (
        args: Omit<HandlerArgs<Out<TBody>, Out<TQuery>, undefined, null>, 'params'>
    ) => Promise<ApiResult | Response>
}

/** Same as `route` for endpoints that do not need a session (login, forgot/reset password). */
export function publicRoute<TBody extends ZodOrNone = undefined, TQuery extends ZodOrNone = undefined>(
    options: PublicRouteOptions<TBody, TQuery>
) {
    return async (request: Request, context?: RouteContext): Promise<Response> => {
        try {
            assertSameOrigin(request)
            const inputs = await parseInputs(request, context, options)
            const supabase = await createSupabaseServerClient()
            return toResponse(
                await options.handler({ request, user: null, supabase, body: inputs.body, query: inputs.query })
            )
        } catch (error) {
            return toErrorResponse(error)
        }
    }
}
