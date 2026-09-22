import { describe, expect, test } from 'bun:test'
import { AppError, fromDatabaseError, isDatabaseError, assertNoError } from './errors'

describe('fromDatabaseError', () => {
    const cases: Array<[string, number, string]> = [
        ['23505', 409, 'conflict'],
        ['23503', 409, 'conflict'],
        ['23514', 422, 'unprocessable'],
        ['23502', 422, 'unprocessable'],
        ['22P02', 400, 'bad_request'],
        ['42501', 403, 'forbidden'],
        ['PGRST116', 404, 'not_found'],
        ['PGRST301', 401, 'unauthorized'],
        ['XX000', 500, 'internal_error']
    ]
    test.each(cases)('%s -> %d %s', (code, status, appCode) => {
        const error = fromDatabaseError({ code, message: 'raw driver text: secret_table.secret_column' })
        expect(error).toBeInstanceOf(AppError)
        expect(error.status).toBe(status)
        expect(error.code).toBe(appCode as AppError['code'])
    })

    test('a unique violation on a known constraint names only the API field, never the constraint', () => {
        const dup = (constraint: string) =>
            fromDatabaseError({
                code: '23505',
                message: `duplicate key value violates unique constraint "${constraint}"`,
                details: 'Key (x)=(secret-value) already exists.'
            })
        expect(dup('products_sku_key').details).toEqual({ field: 'sku' })
        expect(dup('products_barcode_key').details).toEqual({ field: 'barcode' })
        expect(dup('some_other_key').details).toBeUndefined()
        expect(JSON.stringify(dup('products_barcode_key'))).not.toMatch(/products_barcode_key|secret-value/)
    })

    test('never leaks raw driver messages', () => {
        for (const [code] of cases) {
            expect(fromDatabaseError({ code, message: 'raw driver text: secret_table' }).message).not.toContain(
                'secret_table'
            )
        }
    })

    test('P0002 (not found in an RPC) maps to 404 with our message', () => {
        const error = fromDatabaseError({ code: 'P0002', message: 'Order not found' })
        expect(error.status).toBe(404)
        expect(error.message).toBe('Order not found')
    })

    test('passes through messages raised by our own RPCs (P0001)', () => {
        const error = fromDatabaseError({ code: 'P0001', message: 'insufficient stock for product abc' })
        expect(error.status).toBe(422)
        expect(error.message).toBe('insufficient stock for product abc')
    })
})

describe('assertNoError / isDatabaseError', () => {
    test('throws the mapped error', () => {
        expect(() => assertNoError({ code: '23505', message: 'dup' })).toThrow('same unique value')
        expect(() => assertNoError(null)).not.toThrow()
    })
    test('recognizes database errors structurally', () => {
        expect(isDatabaseError({ code: '1', message: 'x' })).toBe(true)
        expect(isDatabaseError(new Error('x'))).toBe(false)
        expect(isDatabaseError(null)).toBe(false)
    })
})
