import { create } from 'zustand'
import type { Profile } from '@/types'

interface AuthStore {
    user: Profile | null
    setUser: (user: Profile | null) => void
    isAdmin: () => boolean
    isManager: () => boolean
    canManageProducts: () => boolean
}

export const useAuthStore = create<AuthStore>((set, get) => ({
    user: null,

    setUser: (user) => set({ user }),

    isAdmin: () => get().user?.role === 'admin',

    isManager: () => get().user?.role === 'manager',

    canManageProducts: () => {
        const role = get().user?.role
        return role === 'admin' || role === 'manager'
    }
}))
