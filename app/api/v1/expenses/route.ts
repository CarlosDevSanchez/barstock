import { created, ok, route } from '@/lib/server/http'
import { createExpense, listExpenses } from '@/lib/server/services/expenses'
import { expenseCreateSchema, expensesQuerySchema } from '@/lib/validation/expenses'

export const GET = route({
    role: 'manager',
    query: expensesQuerySchema,
    handler: async ({ supabase, query }) => ok(await listExpenses(supabase, query))
})

export const POST = route({
    role: 'manager',
    body: expenseCreateSchema,
    handler: async ({ supabase, body }) => created(await createExpense(supabase, body))
})
