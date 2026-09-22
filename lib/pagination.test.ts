import { describe, expect, test } from 'bun:test'
import { pageItems, PAGE_SIZES } from './pagination'

describe('PAGE_SIZES', () => {
    test('is 10/25/50, smallest first', () => {
        expect(PAGE_SIZES).toEqual([10, 25, 50])
    })
})

describe('pageItems', () => {
    test('no pages returns an empty list', () => {
        expect(pageItems(1, 0)).toEqual([])
    })

    test('a single page shows just that page', () => {
        expect(pageItems(1, 1)).toEqual([1])
    })

    test('few pages: every page number, no ellipsis', () => {
        expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5])
        expect(pageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
    })

    test('current page in the middle: ellipsis on both sides', () => {
        expect(pageItems(5, 20)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 20])
    })

    test('page 1: ellipsis only on the right', () => {
        expect(pageItems(1, 20)).toEqual([1, 2, 'ellipsis', 20])
    })

    test('page 2: still no room for a left ellipsis', () => {
        expect(pageItems(2, 20)).toEqual([1, 2, 3, 'ellipsis', 20])
    })

    test('last page: ellipsis only on the left', () => {
        expect(pageItems(20, 20)).toEqual([1, 'ellipsis', 19, 20])
    })

    test('second-to-last page: still no room for a right ellipsis', () => {
        expect(pageItems(19, 20)).toEqual([1, 'ellipsis', 18, 19, 20])
    })

    test('clamps an out-of-range page instead of breaking', () => {
        expect(pageItems(999, 20)).toEqual(pageItems(20, 20))
        expect(pageItems(0, 20)).toEqual(pageItems(1, 20))
    })
})
