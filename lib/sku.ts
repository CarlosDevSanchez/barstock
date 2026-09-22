/**
 * Pure helper for suggesting a SKU from a product name. It is only a starting point shown in the form: the
 * user can always edit it, and the database still enforces SKU uniqueness (`products.sku`, `UNIQUE`).
 */

const MAX_LENGTH = 64
const MAX_WORDS = 4
const LETTERS_PER_WORD = 3

/** Strips accents/diacritics, e.g. "café" -> "cafe". */
function stripAccents(value: string): string {
    return value.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Keeps only [A-Z0-9] from an already-uppercased, accent-stripped word. */
function keepAlphanumeric(word: string): string {
    return word.replace(/[^A-Z0-9]/g, '')
}

/**
 * Suggests a SKU from a product name: strips accents, uppercases, keeps only [A-Z0-9], and takes up to 3
 * letters from each of the first 3-4 words, joined by "-". A word that contains a digit (e.g. "330ml") is
 * kept whole instead of truncated, since the number is what identifies it. Capped at 64 characters.
 *
 * Example: "Cerveza Club Colombia 330ml" -> "CER-CLU-COL-330ML".
 */
export function suggestSku(name: string): string {
    const words = stripAccents(name)
        .toUpperCase()
        .trim()
        .split(/\s+/)
        .map(keepAlphanumeric)
        .filter(word => word.length > 0)

    const segments = words.slice(0, MAX_WORDS).map(word => (/\d/.test(word) ? word : word.slice(0, LETTERS_PER_WORD)))

    return segments.join('-').slice(0, MAX_LENGTH)
}
