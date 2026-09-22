'use client'

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ImageIcon, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { downscaleToWebp } from '@/lib/image-resize'

interface ProductImageFieldProps {
    label: string
    /** Signed URL of the currently saved image (product.image_url / settings.store_logo_url), or null. */
    existingUrl: string | null
    /** A file the user just picked (already downscaled to WebP), pending upload. */
    file: File | null
    /** The user asked to remove the existing image (and has not picked a new one since). */
    removed: boolean
    onSelect: (file: File) => void
    onRemove: () => void
    /** Cancels a pending selection (`file`) and goes back to showing `existingUrl`. */
    onUndo: () => void
    disabled?: boolean
    addLabel: string
    changeLabel: string
    removeLabel: string
    resizeErrorLabel: string
}

/**
 * File picker + preview for a product or store-logo image. Reused by ProductDialog (products/{id}/image) and the
 * Settings page (settings/logo): the caller owns the pending file/removed state and does the actual upload once
 * the parent record has an id (see ProductDialog's onSubmit — a product must exist before its image can be
 * attached). Never uploads by itself and never talks to lib/api directly.
 */
export function ProductImageField({
    label,
    existingUrl,
    file,
    removed,
    onSelect,
    onRemove,
    onUndo,
    disabled,
    addLabel,
    changeLabel,
    removeLabel,
    resizeErrorLabel
}: ProductImageFieldProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [busy, setBusy] = useState(false)

    // A blob: URL, not state: creating it during render is cheap and synchronous, and the effect below only
    // revokes it (no setState in an effect body).
    const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
    useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl)
        }
    }, [previewUrl])

    const displayUrl = file ? previewUrl : removed ? null : existingUrl

    const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
        const picked = event.target.files?.[0]
        event.target.value = '' // allow picking the same file again later
        if (!picked) return
        setBusy(true)
        try {
            onSelect(await downscaleToWebp(picked))
        } catch {
            toast.error(resizeErrorLabel)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="col-span-2 flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                {displayUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob: preview, or a signed, arbitrary-sized R2 URL
                    <img src={displayUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                    <ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
                )}
            </div>
            <div className="flex flex-1 flex-col gap-2">
                <Label>{label}</Label>
                <div className="flex flex-wrap gap-2">
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={event => void handleFiles(event)}
                        disabled={disabled || busy}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled || busy}
                        onClick={() => inputRef.current?.click()}
                    >
                        <Upload className="mr-2 h-4 w-4" />
                        {displayUrl ? changeLabel : addLabel}
                    </Button>
                    {displayUrl && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={disabled || busy}
                            onClick={() => (file ? onUndo() : onRemove())}
                        >
                            <X className="mr-2 h-4 w-4" />
                            {removeLabel}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}
