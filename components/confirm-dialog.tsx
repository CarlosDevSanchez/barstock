'use client'

import { useState, type ReactNode } from 'react'
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description: ReactNode
    confirmLabel: string
    /** Runs when the user confirms; the dialog stays open (button disabled) until it settles, and closes on success. */
    onConfirm: () => Promise<void>
    destructive?: boolean
}

/** Replaces window.confirm(): accessible, non-blocking, and it shows progress while the action runs. */
export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel,
    onConfirm,
    destructive = true
}: ConfirmDialogProps) {
    const [pending, setPending] = useState(false)

    const handleConfirm = async () => {
        setPending(true)
        try {
            await onConfirm()
            onOpenChange(false)
        } catch {
            // The caller reports the error (toast); keep the dialog open so the user can retry or cancel.
        } finally {
            setPending(false)
        }
    }

    return (
        <AlertDialog open={open} onOpenChange={next => !pending && onOpenChange(next)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                    <Button
                        variant={destructive ? 'destructive' : 'default'}
                        disabled={pending}
                        onClick={handleConfirm}
                    >
                        {pending ? 'Working…' : confirmLabel}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
