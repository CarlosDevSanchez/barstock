import { useState } from 'react'

/**
 * Decides whether to render an `<img>` for a (signed, expiring) image URL or fall back to an icon. The failure is
 * remembered per URL, not as a plain boolean: once a signed URL expires (403) and `onError` fires, a list refetch
 * that brings a fresh URL to the same, still-mounted component must show the image again.
 */
export function useImageFallback(url: string | null | undefined): { showImage: boolean; onError: () => void } {
    const [failedUrl, setFailedUrl] = useState<string | null>(null)
    return {
        showImage: !!url && failedUrl !== url,
        onError: () => setFailedUrl(url ?? null)
    }
}
