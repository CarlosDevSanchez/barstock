'use client'

import { useTranslations } from 'next-intl'
import { useFormField } from '@/components/ui/form'
import { cn } from '@/lib/utils'

/**
 * Like shadcn's FormMessage, but if the zod error is a message key (`validation.*`) it is translated.
 * Plain text (legacy or third-party) is shown as-is.
 */
export function TranslatedFormMessage({ className, ...props }: React.ComponentProps<'p'>) {
    const { error, formMessageId } = useFormField()
    const t = useTranslations()
    const raw = error ? String(error.message ?? '') : typeof props.children === 'string' ? props.children : ''
    if (!raw) return null
    const body = raw.startsWith('validation.') && t.has(raw as never) ? t(raw as never) : raw
    return (
        <p data-slot="form-message" id={formMessageId} className={cn('text-destructive text-sm', className)} {...props}>
            {body}
        </p>
    )
}
