import { describe, expect, test } from 'bun:test'
import { Constants } from '@/types/database'
import { roleAtLeast, USER_ROLES } from './roles'

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

describe('enums stay in sync with the database', () => {
    test('user_role', () => {
        expect([...USER_ROLES]).toEqual([...Constants.public.Enums.user_role])
    })
})
