declare module 'web-push' {
    export interface PushSubscription {
        endpoint: string
        keys: { p256dh: string; auth: string }
    }
    export interface SendResult {
        statusCode: number
        body: string
        headers: Record<string, string | string[] | undefined>
    }
    export class WebPushError extends Error {
        statusCode: number
        headers: Record<string, string | string[] | undefined>
        body: string
        endpoint: string
    }
    export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void
    export function sendNotification(
        subscription: PushSubscription,
        payload?: string | Buffer | null,
        options?: object
    ): Promise<SendResult>
}
