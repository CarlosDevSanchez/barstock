import { noContent, route } from '@/lib/server/http'
import { voidExpense } from '@/lib/server/services/expenses'
import { idParamsSchema } from '@/lib/validation/common'
import { expenseVoidSchema } from '@/lib/validation/expenses'

export const DELETE = route({
    role: 'admin',
    params: idParamsSchema,
    body: expenseVoidSchema,
    handler: async ({ supabase, params, body }) => {
        await voidExpense(supabase, params.id, body)
        return noContent()
    }
})
