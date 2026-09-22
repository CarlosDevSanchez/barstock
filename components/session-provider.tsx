'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { UserRole } from '@/lib/auth/roles'
import type { AppLocale } from '@/lib/i18n/config'
import { moneyLocale } from '@/lib/i18n/config'
import { formatMoney } from '@/lib/money'
import type { SettingsInput } from '@/lib/validation/resources'

export interface SessionUser {
    id: string
    email: string
    fullName: string | null
    role: UserRole
    locale: AppLocale
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

/** Formats with the store currency and the signed-in user's UI language. */
export function useMoney() {
    const { settings, user } = useSession()
    return (amount: number) => formatMoney(amount, settings.currency, moneyLocale(user.locale))
}
