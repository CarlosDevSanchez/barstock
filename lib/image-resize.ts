// Client-only (canvas/createImageBitmap): downscales an image in the browser before it is uploaded, so a phone
// photo never has to travel to the server (or the POS grid) at full size. lib/server/storage.ts still validates
// the real bytes server-side: this is a UX/bandwidth optimization, not a security boundary.

/** Downscales `file` to WebP (longest side <= `maxSide`) and returns a new `File` ready to upload. */
export async function downscaleToWebp(file: File, maxSide = 800, quality = 0.85): Promise<File> {
    const bitmap = await createImageBitmap(file)
    try {
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
        const width = Math.max(1, Math.round(bitmap.width * scale))
        const height = Math.max(1, Math.round(bitmap.height * scale))

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D context unavailable')
        ctx.drawImage(bitmap, 0, 0, width, height)

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                result => (result ? resolve(result) : reject(new Error('WebP encoding failed'))),
                'image/webp',
                quality
            )
        })
        const name = `${file.name.replace(/\.[^./]+$/, '') || 'image'}.webp`
        return new File([blob], name, { type: 'image/webp' })
    } finally {
        bitmap.close()
    }
}
