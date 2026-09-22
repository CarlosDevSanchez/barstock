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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { errorMessage } from '@/lib/api/client'
import { tabsApi, type TabDetail } from '@/lib/api/tabs'

export interface CustomerOption {
    id: string
    name: string
    phone: string | null
}

interface OpenTabDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    customers: CustomerOption[]
    onOpened: (tab: TabDetail) => void
}

/** Opens a new tab: a label ("Mesa 4", "Jhon"), an optional linked customer, and the people to split it with later
 * (typed as a comma-separated list — most tabs start with 2-4 names, so this beats a dynamic list of inputs). */
export function OpenTabDialog({ open, onOpenChange, customers, onOpened }: OpenTabDialogProps) {
    const t = useTranslations('tabs')
    const tc = useTranslations('common')
    const [label, setLabel] = useState('')
    const [customerId, setCustomerId] = useState('')
    const [membersText, setMembersText] = useState('')
    const [submitting, setSubmitting] = useState(false)

    const reset = () => {
        setLabel('')
        setCustomerId('')
        setMembersText('')
    }

    const handleSubmit = async () => {
        setSubmitting(true)
        try {
            const members = membersText
                .split(',')
                .map(name => name.trim())
                .filter(Boolean)
            const tab = await tabsApi.open({ label, customer_id: customerId || null, members })
            toast.success(t('opened', { tabNumber: tab.tab_number }))
            reset()
            onOpenChange(false)
            onOpened(tab)
        } catch (error: unknown) {
            toast.error(errorMessage(error, t('openFailed')))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={next => !submitting && onOpenChange(next)}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('openTab')}</DialogTitle>
                    <DialogDescription>{t('openTabDescription')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label htmlFor="tab-label">{t('label')}</Label>
                        <Input
                            id="tab-label"
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            placeholder={t('labelPlaceholder')}
                            maxLength={120}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>{t('customerOptional')}</Label>
                        <Select
                            value={customerId || undefined}
                            onValueChange={value => setCustomerId(value === '__none__' ? '' : value)}
                        >
                            <SelectTrigger aria-label={t('customerOptional')}>
                                <SelectValue placeholder={t('noCustomer')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">{t('noCustomer')}</SelectItem>
                                {customers.map(customer => (
                                    <SelectItem key={customer.id} value={customer.id}>
                                        {customer.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="tab-members">{t('members')}</Label>
                        <Input
                            id="tab-members"
                            value={membersText}
                            onChange={e => setMembersText(e.target.value)}
                            placeholder={t('membersPlaceholder')}
                        />
                        <p className="text-xs text-muted-foreground">{t('membersHint')}</p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
                        {tc('cancel')}
                    </Button>
                    <Button onClick={handleSubmit} disabled={submitting || label.trim() === ''}>
                        {submitting ? t('opening') : t('openTab')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
