import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(import.meta.dir, '../app/globals.css'), 'utf8')

/** Declarations of `--token: value;` inside the `selector { … }` block (comments removed). */
function tokens(selector: string): Map<string, string> {
    const start = css.indexOf(`${selector} {`)
    expect(start).toBeGreaterThanOrEqual(0)
    const body = css
        .slice(start)
        .slice(css.slice(start).indexOf('{') + 1, css.slice(start).indexOf('\n}'))
        .replace(/\/\*[\s\S]*?\*\//g, '')
    const map = new Map<string, string>()
    for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) map.set(match[1]!, match[2]!.trim())
    return map
}

// Tailwind v4 uses the variables as-is (`--color-popover: var(--popover)`): a bare "0 0% 100%" produces an invalid
// `background-color` that the browser drops, which left selects, dropdowns and cards transparent.
describe('globals.css design tokens', () => {
    for (const selector of [':root', '.dark']) {
        test(`${selector}: every color token is a complete color, not bare HSL channels`, () => {
            const colors = [...tokens(selector)].filter(([name]) => name !== '--radius')
            expect(colors.length).toBeGreaterThan(20)
            for (const [name, value] of colors) {
                expect({ name, valid: /^hsl\(\s*[\d.]+ [\d.]+% [\d.]+%\s*\)$/.test(value) }).toEqual({
                    name,
                    valid: true
                })
            }
        })
    }

    test('light and dark define the same tokens', () => {
        expect([...tokens('.dark').keys()].sort()).toEqual(
            [...tokens(':root').keys()].filter(k => k !== '--radius').sort()
        )
    })

    test('every --color-* alias in @theme points to a token defined in :root', () => {
        const defined = tokens(':root')
        const theme = css.slice(css.indexOf('@theme inline'), css.indexOf('\n}\n'))
        const aliases = [...theme.matchAll(/--color-[\w-]+:\s*var\((--[\w-]+)\)/g)].map(m => m[1]!)
        expect(aliases.length).toBeGreaterThan(20)
        for (const alias of aliases) expect({ alias, defined: defined.has(alias) }).toEqual({ alias, defined: true })
    })
})
