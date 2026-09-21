import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/server/supabase'

const paramsSchema = z.object({ token_hash: z.string().min(1), type: z.enum(['invite', 'recovery']) })

// Target of the invitation and password-recovery emails (supabase/templates). Exchanges the one-time token for a session
// cookie on the server, then sends the user to choose a password. Note: a mail scanner that opens the link first would
// consume the token; the user then asks for a new one.
export async function GET(request: NextRequest) {
    const target = (path: string, search?: string) => {
        const url = request.nextUrl.clone()
        url.pathname = path
        url.search = search ?? ''
        return NextResponse.redirect(url)
    }

    const params = paramsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!params.success) return target('/login', '?error=invalid_link')

    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.verifyOtp({ type: params.data.type, token_hash: params.data.token_hash })
    if (error) return target('/login', '?error=invalid_link')

    return target('/reset-password')
}
