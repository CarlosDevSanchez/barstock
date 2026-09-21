'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { UserRole } from '@/lib/auth/roles'
import { formatMoney } from '@/lib/money'
import type { SettingsInput } from '@/lib/validation/resources'

export interface SessionUser {
    id: string
    email: string
    fullName: string | null
    role: UserRole
}

interface SessionValue {
    user: SessionUser
    settings: SettingsInput
}

const SessionContext = createContext<SessionValue | null>(null)

/** Filled by the server layout (session + settings read on the server); refreshed with `router.refresh()`. */
export function SessionProvider({ value, children }: { value: SessionValue; children: ReactNode }) {
    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
    const value = useContext(SessionContext)
    if (!value) throw new Error('useSession must be used inside <SessionProvider>')
    return value
}

/** `money(12.5)` -> "$12.50", using the currency from the store settings. */
export function useMoney() {
    const { settings } = useSession()
    return (amount: number) => formatMoney(amount, settings.currency)
}
