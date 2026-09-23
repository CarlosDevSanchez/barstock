import 'server-only'
import { assertNoError } from '@/lib/server/errors'
import type { AppSupabaseClient } from '@/lib/server/supabase'
import type { Tables } from '@/types/database'
import { LIST_SELECT as PRODUCTS_SELECT, mapProductRows, type ProductListItem } from './products'
import { LIST_SELECT as PROMOTIONS_SELECT, mapPromotionRow, type PromotionListItem } from './promotions'

export interface PosSnapshot {
    generated_at: string
    products: ProductListItem[]
    promotions: PromotionListItem[]
    categories: Array<Pick<Tables<'categories'>, 'id' | 'name'>>
    customers: Array<Pick<Tables<'customers'>, 'id' | 'name' | 'email' | 'phone'>>
}

// A snapshot is meant to fit comfortably in IndexedDB and over the wire; a store with more active rows than this
// needs pagination, which the live /products, /promotions, /categories and /customers endpoints already provide.
const SNAPSHOT_ROW_LIMIT = 2000

/**
 * Everything the POS needs to keep browsing and building a cart without a network round trip per keystroke: active
 * products and promotions, categories and active customers, in the same shape the live list endpoints already
 * return (so the client uses one data model whether online or offline). Checkout itself still needs a live request
 * (create_sale runs the real pricing and stock math); see F1 in docs/06-roadmap/offline-y-sincronizacion.md.
 */
export async function getPosSnapshot(supabase: AppSupabaseClient): Promise<PosSnapshot> {
    const [productsRes, promotionsRes, categoriesRes, customersRes] = await Promise.all([
        supabase
            .from('products')
            .select(PRODUCTS_SELECT)
            .is('deleted_at', null)
            .eq('is_active', true)
            .order('name')
            .limit(SNAPSHOT_ROW_LIMIT),
        supabase
            .from('promotions')
            .select(PROMOTIONS_SELECT)
            .is('deleted_at', null)
            .eq('is_active', true)
            .order('name')
            .limit(SNAPSHOT_ROW_LIMIT),
        supabase.from('categories').select('id, name').order('name').limit(SNAPSHOT_ROW_LIMIT),
        supabase
            .from('customers')
            .select('id, name, email, phone')
            .is('deleted_at', null)
            .eq('is_active', true)
            .order('name')
            .limit(SNAPSHOT_ROW_LIMIT)
    ])
    assertNoError(productsRes.error)
    assertNoError(promotionsRes.error)
    assertNoError(categoriesRes.error)
    assertNoError(customersRes.error)

    return {
        generated_at: new Date().toISOString(),
        products: await mapProductRows(productsRes.data),
        promotions: promotionsRes.data.map(mapPromotionRow),
        categories: categoriesRes.data,
        customers: customersRes.data
    }
}
