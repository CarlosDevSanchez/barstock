import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsStore {
    storeName: string
    currency: string
    taxRate: number
    lowStockThreshold: number
    theme: 'light' | 'dark'

    setStoreName: (name: string) => void
    setCurrency: (currency: string) => void
    setTaxRate: (rate: number) => void
    setLowStockThreshold: (threshold: number) => void
    setTheme: (theme: 'light' | 'dark') => void
}

export const useSettingsStore = create<SettingsStore>()(
    persist(
        (set) => ({
            storeName: 'POS Inventory System',
            currency: 'USD',
            taxRate: 0.1,
            lowStockThreshold: 10,
            theme: 'light',

            setStoreName: (name) => set({ storeName: name }),
            setCurrency: (currency) => set({ currency }),
            setTaxRate: (rate) => set({ taxRate: rate }),
            setLowStockThreshold: (threshold) => set({ lowStockThreshold: threshold }),
            setTheme: (theme) => set({ theme }),
        }),
        {
            name: 'pos-settings',
        }
    )
)
