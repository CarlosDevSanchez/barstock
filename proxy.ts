import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { sessionCookieOptions } from '@/lib/auth/cookie-options'
import { roleAtLeast, USER_ROLES, type UserRole } from '@/lib/auth/roles'
import { clientEnv } from '@/lib/env/client'

// UX guard + early 401. It is NOT the security boundary: every Route Handler re-checks the role (route()) and RLS decides the data.
const PUBLIC_PAGES = ['/login', '/forgot-password', '/reset-password', '/auth/confirm']
// Reachable while signed in: the user may open an invitation/recovery link, and must be able to set a password.
const SIGNED_IN_ALLOWED = ['/reset-password', '/auth/confirm']
const PUBLIC_API_PREFIX = '/api/v1/auth/'
const PAGE_ROLE_GUARDS: Array<{ prefix: string; minimum: UserRole }> = [
    { prefix: '/settings', minimum: 'admin' },
    { prefix: '/users', minimum: 'admin' },
    { prefix: '/reports', minimum: 'manager' },
    { prefix: '/suppliers', minimum: 'manager' }
]

const profileSchema = z.object({ role: z.enum(USER_ROLES), is_active: z.boolean() })

const matches = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

type ProxySupabase = ReturnType<typeof createServerClient>

async function loadProfile(supabase: ProxySupabase, userId: string) {
    const { data } = await supabase.from('profiles').select('role, is_active').eq('id', userId).maybeSingle()
    const profile = profileSchema.safeParse(data)
    return profile.success && profile.data.is_active ? profile.data : null
}

export async function proxy(request: NextRequest) {
    let response = NextResponse.next({ request })

    const supabase = createServerClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        cookies: {
            getAll: () => request.cookies.getAll(),
            setAll: cookiesToSet => {
                for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
                response = NextResponse.next({ request })
                for (const { name, value, options } of cookiesToSet) {
                    response.cookies.set(name, value, sessionCookieOptions(options))
                }
            }
        }
    })

    // Refreshes an expiring session (writes the new cookies onto `response`) and validates the JWT with Supabase Auth.
    const {
        data: { user }
    } = await supabase.auth.getUser()

    const { pathname } = request.nextUrl
    const isApi = pathname.startsWith('/api/')
    const isPublicPage = PUBLIC_PAGES.some(page => matches(pathname, page))
    const isPublicApi = pathname.startsWith(PUBLIC_API_PREFIX)

    // Redirects must carry the refreshed cookies, or the browser keeps the stale session.
    const redirectTo = (path: string, search?: Record<string, string>) => {
        const url = request.nextUrl.clone()
        url.pathname = path
        url.search = ''
        for (const [key, value] of Object.entries(search ?? {})) url.searchParams.set(key, value)
        const redirect = NextResponse.redirect(url)
        for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie)
        return redirect
    }

    if (!user) {
        if (isPublicPage || isPublicApi) return response
        if (isApi) {
            return NextResponse.json(
                { error: { code: 'unauthorized', message: 'Authentication required' } },
                { status: 401, headers: { 'Cache-Control': 'no-store' } }
            )
        }
        return redirectTo('/login', pathname === '/' ? undefined : { next: pathname + request.nextUrl.search })
    }

    if (isPublicPage && !SIGNED_IN_ALLOWED.some(page => matches(pathname, page))) {
        // A valid session is not enough: a disabled account (or one without a profile) would bounce between /login (here) and the
        // dashboard layout (which sends it back to /login) forever. Such a session is ended instead.
        if (await loadProfile(supabase, user.id)) return redirectTo('/dashboard')
        await supabase.auth.signOut() // clears the session cookies onto `response`
        return response
    }

    const guard = PAGE_ROLE_GUARDS.find(({ prefix }) => matches(pathname, prefix))
    if (guard && !isApi) {
        const profile = await loadProfile(supabase, user.id)
        if (!profile) return redirectTo('/login')
        if (!roleAtLeast(profile.role, guard.minimum)) return redirectTo('/dashboard')
    }

    return response
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)']
}
