import { created, paginated, route } from '@/lib/server/http'
import { listTabs, openTab } from '@/lib/server/services/tabs'
import { openTabSchema, tabsQuerySchema } from '@/lib/validation/tabs'

export const GET = route({
    role: 'cashier',
    query: tabsQuerySchema,
    handler: async ({ supabase, query }) => {
        const { rows, total } = await listTabs(supabase, query)
        return paginated(rows, { page: query.page, pageSize: query.pageSize, total })
    }
})

export const POST = route({
    role: 'cashier',
    body: openTabSchema,
    handler: async ({ supabase, body }) => created(await openTab(supabase, body))
})
