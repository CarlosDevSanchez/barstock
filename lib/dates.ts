/** Calendar date (YYYY-MM-DD) of `now` in an IANA time zone, shifted by `offsetDays`. Matches how the SQL reports bucket days. */
export function dateInZone(timeZone: string, offsetDays = 0, now: Date = new Date()): string {
    const shifted = new Date(now.getTime() + offsetDays * 86_400_000)
    // 'en-CA' formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
        shifted
    )
}

/** 'YYYY-MM-DD' -> Date at local midnight, for display formatting only (it is a calendar date, not an instant). */
export function calendarDate(value: string): Date {
    return new Date(`${value}T00:00:00`)
}
