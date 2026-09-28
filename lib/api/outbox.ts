import type { OutboxDiscardInput } from '@/lib/validation/resources'
import { apiPost } from './client'

export const outboxApi = {
    /** Manager-only audit trail for discarding a queued (never-synced) offline sale (F4). */
    logDiscard: (body: OutboxDiscardInput) => apiPost<void>('outbox/discard-log', body)
}
