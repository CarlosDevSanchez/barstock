'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { errorMessage } from '@/lib/api/client'
import { tabsApi, type TabDetail, type TabListItem } from '@/lib/api/tabs'
import { OpenTabDialog, type CustomerOption } from './open-tab-dialog'

interface AddToTabDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    openTabs: TabListItem[]
    customers: CustomerOption[]
    items: Array<{ product_id: string; quantity: number }>
    onAdded: (tab: TabDetail) => void
}

/** Sends the current cart's lines to an existing open tab, or a brand new one, instead of charging it now. */
export function AddToTabDialog({ open, onOpenChange, openTabs, customers, items, onAdded }: AddToTabDialogProps) {
    const t = useTranslations('tabs')
    const tc = useTranslations('common')
    const [tabId, setTabId] = useState('')
    const [showNewTab, setShowNewTab] = useState(false)
    const [submitting, setSubmitting] = useState(false)

    const addTo = async (id: string) => {
        setSubmitting(true)
        try {
            const tab = await tabsApi.addItems(id, { items })
            toast.success(t('itemsAdded', { tabNumber: tab.tab_number }))
            setTabId('')
            onOpenChange(false)
            onAdded(tab)
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('addItemsFailed')))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <>
            <Dialog open={open && !showNewTab} onOpenChange={next => !submitting && onOpenChange(next)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('addToTab')}</DialogTitle>
                        <DialogDescription>{t('addToTabDescription')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        {openTabs.length > 0 ? (
                            <Select value={tabId || undefined} onValueChange={setTabId}>
                                <SelectTrigger aria-label={t('chooseTab')}>
                                    <SelectValue placeholder={t('chooseTab')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {openTabs.map(tab => (
                                        <SelectItem key={tab.id} value={tab.id}>
                                            {tab.label} · {tab.tab_number}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <p className="text-sm text-muted-foreground">{t('noOpenTabs')}</p>
                        )}
                        <Button type="button" variant="outline" className="w-full" onClick={() => setShowNewTab(true)}>
                            {t('newTab')}
                        </Button>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
                            {tc('cancel')}
                        </Button>
                        <Button disabled={submitting || !tabId} onClick={() => addTo(tabId)}>
                            {submitting ? t('adding') : t('addToTab')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <OpenTabDialog
                open={showNewTab}
                onOpenChange={setShowNewTab}
                customers={customers}
                onOpened={tab => addTo(tab.id)}
            />
        </>
    )
}
