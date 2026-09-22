'use client'

import { Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { TabListItem } from '@/lib/api/tabs'

interface TabsPanelProps {
    tabs: TabListItem[]
    loading: boolean
    onOpenNew: () => void
    onSelect: (tabId: string) => void
}

/** The "Tabs" side of the cart sheet: every open tab, tap one to see its detail and take payments. */
export function TabsPanel({ tabs, loading, onOpenNew, onSelect }: TabsPanelProps) {
    const t = useTranslations('tabs')

    return (
        <div className="space-y-3">
            <Button type="button" onClick={onOpenNew} className="w-full" variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                {t('openTab')}
            </Button>
            {loading ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t('loadingTabs')}</p>
            ) : tabs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t('noOpenTabs')}</p>
            ) : (
                <ul className="space-y-2">
                    {tabs.map(tab => (
                        <li key={tab.id}>
                            <button
                                type="button"
                                onClick={() => onSelect(tab.id)}
                                className="w-full text-left rounded-xl border p-3 hover:bg-muted transition"
                            >
                                <div className="flex justify-between items-center gap-2">
                                    <span className="font-medium truncate">{tab.label}</span>
                                    <span className="text-xs text-muted-foreground shrink-0">{tab.tab_number}</span>
                                </div>
                                {tab.customer && (
                                    <p className="text-xs text-muted-foreground truncate">{tab.customer.name}</p>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
