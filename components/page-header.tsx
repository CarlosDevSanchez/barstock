import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Fab } from '@/components/fab'

interface PrimaryAction {
    label: string
    icon: React.ComponentType<{ className?: string }>
    onClick: () => void
}

interface PageHeaderProps {
    title: string
    description?: string
    actions?: ReactNode
    primaryAction?: PrimaryAction
}

/** Replaces the `flex items-center justify-between` header repeated at the top of every list page. */
export function PageHeader({ title, description, actions, primaryAction }: PageHeaderProps) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight truncate lg:text-3xl">{title}</h1>
                {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {actions}
                {primaryAction && (
                    <>
                        <Button onClick={primaryAction.onClick} className="hidden lg:inline-flex">
                            <primaryAction.icon className="mr-2 h-4 w-4" />
                            {primaryAction.label}
                        </Button>
                        <Fab onClick={primaryAction.onClick} label={primaryAction.label} icon={primaryAction.icon} />
                    </>
                )}
            </div>
        </div>
    )
}
