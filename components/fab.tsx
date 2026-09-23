import { Button } from '@/components/ui/button'

interface FabProps {
    onClick: () => void
    label: string
    icon: React.ComponentType<{ className?: string }>
}

/** The single primary action on a mobile list screen. Only one per page. */
export function Fab({ onClick, label, icon: Icon }: FabProps) {
    return (
        <Button
            onClick={onClick}
            aria-label={label}
            size="icon"
            className="fixed right-4 bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] z-40 size-14 rounded-full shadow-lg touch-manipulation lg:hidden"
        >
            <Icon className="size-6" />
        </Button>
    )
}
