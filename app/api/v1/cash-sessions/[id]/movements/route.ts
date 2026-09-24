import { created, route } from '@/lib/server/http'
import { addCashMovement } from '@/lib/server/services/cash-sessions'
import { idParamsSchema } from '@/lib/validation/common'
import { cashMovementSchema } from '@/lib/validation/cash'

export const POST = route({
    role: 'cashier',
    params: idParamsSchema,
    body: cashMovementSchema,
    handler: async ({ supabase, params, body }) => created(await addCashMovement(supabase, params.id, body))
})
