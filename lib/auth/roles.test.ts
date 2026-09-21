import { describe, expect, test } from 'bun:test'
import { roleAtLeast } from './roles'

describe('roleAtLeast', () => {
    test('is hierarchical', () => {
        expect(roleAtLeast('admin', 'cashier')).toBe(true)
        expect(roleAtLeast('admin', 'manager')).toBe(true)
        expect(roleAtLeast('manager', 'manager')).toBe(true)
        expect(roleAtLeast('manager', 'admin')).toBe(false)
        expect(roleAtLeast('cashier', 'manager')).toBe(false)
        expect(roleAtLeast('cashier', 'cashier')).toBe(true)
    })
})
