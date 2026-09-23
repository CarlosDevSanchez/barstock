import { beforeAll, describe, expect, test } from 'bun:test'
import {
    DELETE as deletePromotion,
    GET as getPromotion,
    PATCH as patchPromotion
} from '@/app/api/v1/promotions/[id]/route'
import { GET as listPromotions, POST as createPromotion } from '@/app/api/v1/promotions/route'
import { adminClient, createProduct as makeProduct, ensureTestUsers, uniq } from '../helpers/integration'
import { dataOf, errorOf, loginAs, TestClient } from '../helpers/http'

let cashier: TestClient
let manager: TestClient

beforeAll(async () => {
    await ensureTestUsers()
    ;[cashier, manager] = await Promise.all([loginAs('cashier'), loginAs('manager')])
})

describe('promotions', () => {
    test('every endpoint requires a session', async () => {
        const anonymous = new TestClient()
        expect((await anonymous.get(listPromotions, 'promotions')).status).toBe(401)
        expect((await anonymous.post(createPromotion, 'promotions', { body: {} })).status).toBe(401)
    })

    test('cashiers read promotions but cannot write them', async () => {
        const product = await makeProduct()
        const created = dataOf<{ id: string }>(
            await manager.post(createPromotion, 'promotions', {
                body: {
                    name: uniq('Promo'),
                    package_price: 20,
                    items: [{ product_id: product.id, quantity: 2 }]
                }
            })
        )
        expect((await cashier.get(listPromotions, 'promotions')).status).toBe(200)
        expect(
            (await cashier.get(getPromotion, `promotions/${created.id}`, { params: { id: created.id } })).status
        ).toBe(200)
        expect(
            (
                await cashier.post(createPromotion, 'promotions', {
                    body: {
                        name: uniq('Hack'),
                        package_price: 1,
                        items: [{ product_id: product.id, quantity: 1 }]
                    }
                })
            ).status
        ).toBe(403)
        expect(
            (
                await cashier.patch(patchPromotion, `promotions/${created.id}`, {
                    params: { id: created.id },
                    body: { name: 'hacked' }
                })
            ).status
        ).toBe(403)
        expect(
            (await cashier.delete(deletePromotion, `promotions/${created.id}`, { params: { id: created.id } })).status
        ).toBe(403)
    })

    test('a manager creates a package with items and soft-deletes it', async () => {
        const a = await makeProduct({ name: uniq('Beer') })
        const b = await makeProduct({ name: uniq('Snack') })
        const response = await manager.post(createPromotion, 'promotions', {
            body: {
                name: uniq('Combo'),
                package_price: '45000',
                items: [
                    { product_id: a.id, quantity: 6 },
                    { product_id: b.id, quantity: 1 }
                ]
            }
        })
        expect(response.status).toBe(201)
        const promo = dataOf<{
            id: string
            package_price: number
            items: Array<{ product_id: string; quantity: number }>
        }>(response)
        expect(promo.package_price).toBe(45000)
        expect(promo.items).toHaveLength(2)

        const patched = dataOf<{ name: string; items: Array<{ quantity: number }> }>(
            await manager.patch(patchPromotion, `promotions/${promo.id}`, {
                params: { id: promo.id },
                body: {
                    name: 'Renamed combo',
                    items: [{ product_id: a.id, quantity: 12 }]
                }
            })
        )
        expect(patched.name).toBe('Renamed combo')
        expect(patched.items).toHaveLength(1)
        expect(patched.items[0]).toMatchObject({ product_id: a.id, quantity: 12 })

        expect(
            (await manager.delete(deletePromotion, `promotions/${promo.id}`, { params: { id: promo.id } })).status
        ).toBe(204)
        expect((await manager.get(getPromotion, `promotions/${promo.id}`, { params: { id: promo.id } })).status).toBe(
            404
        )
        const { data } = await adminClient()
            .from('promotions')
            .select('deleted_at, is_active')
            .eq('id', promo.id)
            .single()
        expect(data?.deleted_at).not.toBeNull()
        expect(data?.is_active).toBe(false)
    })

    test('validation rejects empty items and unknown products', async () => {
        const empty = await manager.post(createPromotion, 'promotions', {
            body: { name: uniq('X'), package_price: 1, items: [] }
        })
        expect(empty.status).toBe(422)

        const missing = await manager.post(createPromotion, 'promotions', {
            body: {
                name: uniq('X'),
                package_price: 1,
                items: [{ product_id: crypto.randomUUID(), quantity: 1 }]
            }
        })
        expect(missing.status).toBe(422)
        expect(errorOf(missing).details).toEqual([{ path: 'items', message: 'validation.unknownProduct' }])
    })
})
