import { describe, expect, test } from 'bun:test'
import { calendarDate, dateInZone } from './dates'

describe('dateInZone', () => {
    const instant = new Date('2026-09-21T02:30:00Z')

    test('uses the calendar day of the given zone, not the machine or UTC', () => {
        expect(dateInZone('UTC', 0, instant)).toBe('2026-09-21')
        expect(dateInZone('America/Los_Angeles', 0, instant)).toBe('2026-09-20') // still the evening before
        expect(dateInZone('Asia/Tokyo', 0, instant)).toBe('2026-09-21')
    })
    test('shifts by whole days', () => {
        expect(dateInZone('UTC', -6, instant)).toBe('2026-09-15')
        expect(dateInZone('UTC', 1, instant)).toBe('2026-09-22')
    })
})

describe('calendarDate', () => {
    test('keeps the calendar day whatever the machine time zone', () => {
        const date = calendarDate('2026-09-21')
        expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 8, 21])
    })
})
