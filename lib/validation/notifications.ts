import { z } from 'zod'

/**
 * Push endpoints are POSTed to by the server (web-push): an open `.url()` lets a client point us at an
 * internal host (SSRF). Only the push services we actually support are allowed, over https.
 */
const ALLOWED_PUSH_HOSTS = [
    /^fcm\.googleapis\.com$/,
    /^[^.]+\.push\.apple\.com$/,
    /^updates\.push\.services\.mozilla\.com$/,
    /^[^.]+\.notify\.windows\.com$/,
    /^[^.]+\.push\.services\.mozilla\.com$/
]

export function isAllowedPushEndpoint(endpoint: string): boolean {
    let url: URL
    try {
        url = new URL(endpoint)
    } catch {
        return false
    }
    return url.protocol === 'https:' && ALLOWED_PUSH_HOSTS.some(pattern => pattern.test(url.hostname))
}

const pushEndpointSchema = z.string().max(2048).refine(isAllowedPushEndpoint, 'validation.pushEndpointNotAllowed')

export const pushSubscriptionSchema = z.object({
    endpoint: pushEndpointSchema,
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
    user_agent: z.string().max(512).nullable().optional()
})

/**
 * Deleting a subscription never makes a request to `endpoint` (it only removes a row keyed by it), so it must
 * NOT apply the allowlist — otherwise a subscription stored before the allowlist narrowed, or from a host that
 * later stopped being supported, could never be removed by its owner.
 */
export const deletePushSubscriptionSchema = z.object({
    endpoint: z.string().max(2048)
})

export const notificationPrefsSchema = z.object({
    notify_email: z.boolean(),
    notify_push: z.boolean()
})

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>
export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>
