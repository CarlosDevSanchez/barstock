import { noContent, publicRoute } from '@/lib/server/http'
import { signOut } from '@/lib/server/services/auth'

export const POST = publicRoute({
    handler: async ({ supabase }) => {
        await signOut(supabase)
        return noContent()
    }
})
