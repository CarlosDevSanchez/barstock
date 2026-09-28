import type { PosSnapshot } from '@/lib/server/services/pos'
import { apiGet } from './client'

export type { PosSnapshot }

export const posApi = {
    snapshot: (signal?: AbortSignal) => apiGet<PosSnapshot>('pos/snapshot', undefined, signal)
}
