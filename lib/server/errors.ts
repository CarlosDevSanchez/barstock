import 'server-only'

export type ErrorCode =
    | 'bad_request'
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'payload_too_large'
    | 'unsupported_media_type'
    | 'validation_failed'
    | 'too_many_requests'
    | 'unprocessable'
    | 'storage_not_configured'
    | 'push_not_configured'
    | 'internal_error'

const STATUS: Record<ErrorCode, number> = {
    bad_request: 400,
    unauthorized: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    payload_too_large: 413,
    unsupported_media_type: 415,
    validation_failed: 422,
    too_many_requests: 429,
    unprocessable: 422,
    storage_not_configured: 503,
    push_not_configured: 503,
    internal_error: 500
}

export class AppError extends Error {
    readonly status: number

    constructor(
        readonly code: ErrorCode,
        message: string,
        readonly details?: unknown
    ) {
        super(message)
        this.name = 'AppError'
        this.status = STATUS[code]
    }
}

export const badRequest = (message: string, details?: unknown) => new AppError('bad_request', message, details)
export const unauthorized = (message = 'Authentication required') => new AppError('unauthorized', message)
export const forbidden = (message = 'You are not allowed to do this') => new AppError('forbidden', message)
export const tooManyRequests = (message = 'Too many attempts, try again later') =>
    new AppError('too_many_requests', message)
export const notFound = (message = 'Not found') => new AppError('not_found', message)
export const conflict = (message: string, details?: unknown) => new AppError('conflict', message, details)
export const unprocessable = (message: string) => new AppError('unprocessable', message)
export const payloadTooLarge = (message = 'File is too large') => new AppError('payload_too_large', message)
export const unsupportedMediaType = (message = 'Unsupported file type') =>
    new AppError('unsupported_media_type', message)
/** The 4 R2 env vars (lib/env/schema.ts) are not set: image endpoints are disabled until they are. */
export const storageNotConfigured = () => new AppError('storage_not_configured', 'Image storage is not configured')
/** VAPID_* (or the full notification group) unset: push subscribe endpoints answer 503. */
export const pushNotConfigured = () => new AppError('push_not_configured', 'Push notifications are not configured')

/** Structural shape of a PostgREST / Postgres error (supabase-js does not throw: it returns `{ error }`). */
export interface DatabaseError {
    code?: string
    message: string
    details?: string | null
    hint?: string | null
}

export function isDatabaseError(value: unknown): value is DatabaseError {
    return typeof value === 'object' && value !== null && 'message' in value && 'code' in value
}

/**
 * Unique constraints whose violation the UI can pin to a form field. Only the API field name goes back to the client
 * (`details: { field }`), never the constraint name, the raw message or the duplicated value. Anything not listed
 * stays a plain 409 without details, and the UI falls back to a generic toast.
 */
const UNIQUE_CONSTRAINT_FIELDS: Record<string, string> = {
    products_sku_key: 'sku',
    products_barcode_key: 'barcode'
}

/** `duplicate key value violates unique constraint "products_sku_key"` -> `{ field: 'sku' }`, or undefined. */
function uniqueViolationDetails(message: string): { field: string } | undefined {
    const constraint = /unique constraint "([^"]+)"/.exec(message)?.[1]
    const field = constraint ? UNIQUE_CONSTRAINT_FIELDS[constraint] : undefined
    return field ? { field } : undefined
}

/**
 * Maps a Postgres/PostgREST error to an AppError without leaking raw driver messages.
 * The exceptions are P0001 (business rule) and P0002 (not found) raised by our own RPCs, e.g. `Insufficient stock for "X"`:
 * those messages are authored by us for the client.
 */
export function fromDatabaseError(error: DatabaseError): AppError {
    switch (error.code) {
        case '23505':
            return conflict('A record with the same unique value already exists', uniqueViolationDetails(error.message))
        case '23503':
            return conflict('The record is referenced by, or refers to, another record')
        case '23514':
            return unprocessable('A value violates a data rule')
        case '23502':
            return unprocessable('A required value is missing')
        case '22P02':
        case '22003':
        case '22007':
        case '22008':
            return badRequest('Invalid value')
        case 'P0001':
            return unprocessable(error.message)
        case 'P0002':
            return notFound(error.message)
        case 'BS409':
            // This project's own application code for a conflict raised from PL/pgSQL (idempotency replay), not a
            // real unique-constraint violation. See supabase/migrations/20260927000001_idempotency.sql.
            return conflict(error.message)
        case '42501':
            return forbidden()
        case 'PGRST116':
            return notFound()
        case 'PGRST301':
        case 'PGRST303':
            return unauthorized()
        default:
            return new AppError('internal_error', 'Unexpected error')
    }
}

/** Throws the mapped AppError when a Supabase call returned `{ error }`. Every service call must go through this. */
export function assertNoError(error: DatabaseError | null): asserts error is null {
    if (error) throw fromDatabaseError(error)
}
