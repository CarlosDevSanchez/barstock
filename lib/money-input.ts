/**
 * Pure functions for parsing and formatting user input in money fields, handling locale-specific
 * thousands and decimal separators.
 */

/**
 * Parses a user-entered string (possibly with locale-specific separators) into a numeric value.
 * Returns `null` for empty strings (not `0`—empty means "nothing typed yet") or invalid input.
 * Works in two modes:
 * - COP (decimals=0): both '.' and ',' are thousands separators, never decimal points.
 * - USD/EUR (decimals=2): the rightmost '.' or ',' is the decimal separator.
 */
export function parseMoneyInput(raw: string, decimals: 0 | 2): number | null {
    const trimmed = raw.trim()
    if (trimmed === '') return null

    // Reject input with invalid characters (anything not digit, dot, or comma)
    if (!/^[\d.,]*$/.test(trimmed)) return null

    let normalized: string

    if (decimals === 0) {
        // COP: both . and , are thousands separators, never a decimal point
        // Remove all of them
        normalized = trimmed.replace(/[.,]/g, '')
    } else {
        // USD/EUR: the rightmost . or , is the decimal separator
        const lastDotIndex = trimmed.lastIndexOf('.')
        const lastCommaIndex = trimmed.lastIndexOf(',')
        const decimalIndex = Math.max(lastDotIndex, lastCommaIndex)

        if (decimalIndex === -1) {
            // No separator found, treat as integer
            normalized = trimmed
        } else {
            const beforeDecimal = trimmed.substring(0, decimalIndex)
            const afterDecimal = trimmed.substring(decimalIndex + 1)

            // Validate: afterDecimal should not contain any separators
            if (/[.,]/.test(afterDecimal)) return null

            // Validate thousands separators in beforeDecimal
            const separatorPositions: number[] = []
            for (let i = 0; i < beforeDecimal.length; i++) {
                if (beforeDecimal[i] === '.' || beforeDecimal[i] === ',') {
                    separatorPositions.push(i)
                }
            }

            // Thousands separators must be in valid positions:
            // - First separator at position 1-3 (1-3 digits before it)
            // - Subsequent separators exactly 4 positions after previous (3 digits + separator)
            // - Last group (after last separator) must have exactly 3 digits
            if (separatorPositions.length > 0) {
                const firstSeparator = separatorPositions[0]
                if (firstSeparator === undefined || firstSeparator < 1 || firstSeparator > 3) return null
                for (let i = 0; i < separatorPositions.length - 1; i++) {
                    const current = separatorPositions[i]
                    const next = separatorPositions[i + 1]
                    if (current === undefined || next === undefined || next - current !== 4) return null
                }
                // Last group must have exactly 3 digits
                const lastSeparatorPos = separatorPositions[separatorPositions.length - 1]
                if (lastSeparatorPos === undefined) return null
                const lastGroupLength = beforeDecimal.length - lastSeparatorPos - 1
                if (lastGroupLength !== 3) return null
            }

            const cleanedBefore = beforeDecimal.replace(/[.,]/g, '')
            normalized = `${cleanedBefore}.${afterDecimal}`
        }
    }

    // Reject if no digits remain
    if (!/\d/.test(normalized)) return null

    // Parse the normalized string
    const parsed = decimals === 0 ? parseInt(normalized, 10) : parseFloat(normalized)

    return isNaN(parsed) ? null : parsed
}

/**
 * Formats a numeric value with the locale's thousands and decimal separators.
 * Returns an empty string for `null` values.
 * Uses `Intl.NumberFormat` to respect locale-specific formatting conventions.
 */
export function formatMoneyInput(value: number | null, decimals: 0 | 2, locale: string): string {
    if (value === null || value === undefined) return ''

    // Use Intl.NumberFormat to format with the locale's separators
    const formatter = new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: true
    })

    return formatter.format(value)
}
