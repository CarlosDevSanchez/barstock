import { z } from 'zod'

export const pushSubscriptionSchema = z.object({
    endpoint: z.string().url().max(2048),
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
    user_agent: z.string().max(512).nullable().optional()
})

export const deletePushSubscriptionSchema = z.object({
    endpoint: z.string().url().max(2048)
})

export const notificationPrefsSchema = z.object({
    notify_email: z.boolean(),
    notify_push: z.boolean()
})

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>
export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>
