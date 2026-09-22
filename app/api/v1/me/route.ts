import { z } from 'zod'
import { assertNoError, notFound } from '@/lib/server/errors'
import { ok, route } from '@/lib/server/http'
import { setLocaleCookie } from '@/lib/i18n/cookie'
import { APP_LOCALES } from '@/lib/i18n/config'

export const GET = route({ role: 'cashier', handler: async ({ user }) => ok(user) })

const patchMeSchema = z.object({ locale: z.enum(APP_LOCALES) })

export const PATCH = route({
    role: 'cashier',
    body: patchMeSchema,
    handler: async ({ supabase, user, body }) => {
        const { data, error } = await supabase
            .from('profiles')
            .update({ locale: body.locale })
            .eq('id', user.id)
            .select('locale')
            .maybeSingle()
        assertNoError(error)
        if (!data) throw notFound('Profile not found')
        await setLocaleCookie(body.locale)
        return ok({ ...user, locale: body.locale })
    }
})
