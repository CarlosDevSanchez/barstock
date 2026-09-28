'use client'

import { useSyncExternalStore, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import { ReceiptTicket } from './receipt-ticket'

const emptySubscribe = () => () => {}

/**
 * The one print path: a portal on `document.body` so `@media print` can hide every other body child.
 * `ReceiptTicket` stays `hidden` on screen and `print:block` on paper.
 */
export function PrintableReceipt(props: ComponentProps<typeof ReceiptTicket>) {
    const mounted = useSyncExternalStore(
        emptySubscribe,
        () => true,
        () => false
    )
    if (!mounted) return null
    return createPortal(
        <div id="print-root">
            <ReceiptTicket {...props} />
        </div>,
        document.body
    )
}
