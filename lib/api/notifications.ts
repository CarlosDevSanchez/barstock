import { apiDelete, apiGet, apiPatch, apiPost } from './client'
import type { NotificationPrefsInput, PushSubscriptionInput } from '@/lib/validation/notifications'

export const notificationsApi = {
    getPushKey: (signal?: AbortSignal) => apiGet<{ publicKey: string }>('me/push-key', undefined, signal),
    updatePrefs: (body: NotificationPrefsInput) =>
        apiPatch<{ notify_email: boolean; notify_push: boolean }>('me/notifications', body),
    subscribe: (body: PushSubscriptionInput) => apiPost<{ ok: true }>('me/push-subscriptions', body),
    unsubscribe: (endpoint: string) => apiDelete<{ ok: true }>('me/push-subscriptions', { endpoint })
}
