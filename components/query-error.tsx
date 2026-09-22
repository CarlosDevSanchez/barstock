import { Button } from '@/components/ui/button'

export function QueryError({ error, onRetry }: { error: Error; onRetry: () => void }) {
    return (
        <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
            <p className="font-medium">Something went wrong</p>
            <p className="mt-1">{error.message}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
                Try again
            </Button>
        </div>
    )
}
