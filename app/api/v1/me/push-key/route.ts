import { ok, route } from '@/lib/server/http'
import { pushNotConfigured } from '@/lib/server/errors'

export const GET = route({
    role: 'cashier',
    handler: async () => {
        const publicKey = process.env.VAPID_PUBLIC_KEY
        const privateKey = process.env.VAPID_PRIVATE_KEY
        const subject = process.env.VAPID_SUBJECT
        if (!publicKey || !privateKey || !subject) {
            throw pushNotConfigured()
        }
        return ok({ publicKey })
    }
})
