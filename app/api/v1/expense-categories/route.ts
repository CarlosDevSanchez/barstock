import { created, route } from '@/lib/server/http'
import { createExpenseCategory } from '@/lib/server/services/expenses'
import { expenseCategoryCreateSchema } from '@/lib/validation/expenses'

export const POST = route({
    role: 'admin',
    body: expenseCategoryCreateSchema,
    handler: async ({ supabase, body }) => created(await createExpenseCategory(supabase, body))
})
