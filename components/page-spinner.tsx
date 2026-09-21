export function PageSpinner() {
    return (
        <div className="flex items-center justify-center h-full min-h-48" role="status" aria-label="Loading">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
        </div>
    )
}
