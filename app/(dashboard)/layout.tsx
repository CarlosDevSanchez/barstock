import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/app-shell'
import { getSession } from '@/lib/server/auth'
import { getSettings } from '@/lib/server/services/settings'

// Server Component: the session and store settings are resolved on the server (the proxy already redirects, this is the
// second check), so no page has to bootstrap auth in the browser. Pages below it fetch through /api/v1.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
    const session = await getSession()
    if (!session) redirect('/login')
    const settings = await getSettings(session.supabase)
    return (
        <AppShell user={session.user} settings={settings}>
            {children}
        </AppShell>
    )
}
