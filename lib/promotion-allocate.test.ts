import { describe, expect, test } from 'bun:test'
import { allocatePackagePrice, packageBottleneckProductIds, packagesAvailable } from './promotion-allocate'
import { previewTotals } from './cart-preview'

describe('allocatePackagePrice', () => {
    test('bases sum to package_price × packages (2 decimals)', () => {
        const lines = allocatePackagePrice(
            10,
            1,
            [
                { productId: 'a', quantity: 1, sellingPrice: 4, taxRate: 0.1 },
                { productId: 'b', quantity: 1, sellingPrice: 4, taxRate: 0.1 },
                { productId: 'c', quantity: 1, sellingPrice: 4, taxRate: 0 }
            ],
            2
        )
        const sum = lines.reduce((s, l) => s + l.unitPrice * l.quantity - l.discount, 0)
        expect(sum).toBeCloseTo(10, 6)
        expect(lines).toHaveLength(3)
    })

    test('last line absorbs leftover cents', () => {
        const lines = allocatePackagePrice(
            10,
            1,
            [
                { productId: 'a', quantity: 1, sellingPrice: 5, taxRate: 0 },
                { productId: 'b', quantity: 1, sellingPrice: 5, taxRate: 0 }
            ],
            2
        )
        expect(lines[0]!.unitPrice * lines[0]!.quantity - lines[0]!.discount).toBe(5)
        expect(lines[1]!.unitPrice * lines[1]!.quantity - lines[1]!.discount).toBe(5)
    })

    test('scales with package count and multi-qty components', () => {
        const lines = allocatePackagePrice(
            25,
            2,
            [
                { productId: 'beer', quantity: 6, sellingPrice: 3, taxRate: 0.19 },
                { productId: 'snack', quantity: 1, sellingPrice: 5, taxRate: 0.19 }
            ],
            2
        )
        expect(lines[0]!.quantity).toBe(12)
        expect(lines[1]!.quantity).toBe(2)
        const sum = lines.reduce((s, l) => s + l.unitPrice * l.quantity - l.discount, 0)
        expect(sum).toBeCloseTo(50, 6)
    })

    test('zero catalog weight splits evenly', () => {
        const lines = allocatePackagePrice(
            9,
            1,
            [
                { productId: 'a', quantity: 1, sellingPrice: 0, taxRate: 0 },
                { productId: 'b', quantity: 1, sellingPrice: 0, taxRate: 0 },
                { productId: 'c', quantity: 1, sellingPrice: 0, taxRate: 0 }
            ],
            2
        )
        const bases = lines.map(l => l.unitPrice * l.quantity - l.discount)
        expect(bases.reduce((a, b) => a + b, 0)).toBeCloseTo(9, 6)
    })

    test('preview tax uses per-product rates on allocated bases (COP)', () => {
        const lines = allocatePackagePrice(
            35000,
            1,
            [
                { productId: 'a', quantity: 1, sellingPrice: 20000, taxRate: 0.19 },
                { productId: 'b', quantity: 1, sellingPrice: 20000, taxRate: 0 }
            ],
            0
        )
        const totals = previewTotals(
            lines.map(l => ({
                unitPrice: l.unitPrice,
                taxRate: l.taxRate,
                quantity: l.quantity,
                discount: l.discount
            })),
            0,
            0
        )
        expect(totals.subtotal).toBe(35000)
        // Only the taxed half (~17500) pays 19 % → 3325
        expect(totals.tax).toBe(3325)
        expect(totals.total).toBe(38325)
    })
})

describe('packagesAvailable', () => {
    test('floor of the tightest component', () => {
        expect(
            packagesAvailable([
                { quantity: 6, stock: 13 },
                { quantity: 1, stock: 3 }
            ])
        ).toBe(2)
    })
    test('null when any component has no inventory row', () => {
        expect(packagesAvailable([{ quantity: 1, stock: null }])).toBeNull()
    })
    test('zero when stock cannot cover one package', () => {
        expect(packagesAvailable([{ quantity: 6, stock: 5 }])).toBe(0)
    })
    test('two products qty 1 with stock 5 and 3 → 3 packages (bottleneck is the 3)', () => {
        const components = [
            { productId: 'a', quantity: 1, stock: 5 },
            { productId: 'b', quantity: 1, stock: 3 }
        ]
        expect(packagesAvailable(components)).toBe(3)
        expect(packageBottleneckProductIds(components)).toEqual(['b'])
    })
})
