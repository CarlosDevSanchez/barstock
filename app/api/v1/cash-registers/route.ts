import { created, ok, route } from '@/lib/server/http'
import { createRegister, listRegisters } from '@/lib/server/services/cash-sessions'
import { registerCreateSchema } from '@/lib/validation/cash'

export const GET = route({
    role: 'cashier',
    handler: async ({ supabase }) => ok(await listRegisters(supabase))
})

export const POST = route({
    role: 'admin',
    body: registerCreateSchema,
    handler: async ({ supabase, body }) => created(await createRegister(supabase, body.name))
})
