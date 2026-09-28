// Merges the lcov reports of the unit and integration test processes and enforces a line-coverage floor on the code where a
// mistake costs money or security. Multiple processes are needed (see docs/05-guias/testing.md), so Bun's own
// `coverageThreshold` cannot be used: it would judge each process on its own.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const THRESHOLD = 0.8
const GROUPS = ['lib/server', 'lib/validation'] as const
// Three processes since testing.md moved the resend/web-push mock.module tests into their own file/process
// (notifications-dispatch.test.ts), separate from the rest of test/integration.
const REPORTS = ['coverage/unit/lcov.info', 'coverage/integration/lcov.info', 'coverage/integration-dispatch/lcov.info']

const root = process.cwd()
const hits = new Map<string, Map<number, number>>() // file -> line -> max hits across reports

for (const report of REPORTS) {
    if (!existsSync(report)) throw new Error(`Missing ${report}. Run \`bun run test:coverage\`.`)
    let current: Map<number, number> | undefined
    for (const line of readFileSync(report, 'utf8').split('\n')) {
        if (line.startsWith('SF:')) {
            const file = relative(root, join(root, line.slice(3)))
            current = hits.get(file) ?? new Map()
            hits.set(file, current)
        } else if (line.startsWith('DA:') && current) {
            const [lineNo, count] = line.slice(3).split(',').map(Number) as [number, number]
            current.set(lineNo, Math.max(current.get(lineNo) ?? 0, count))
        }
    }
}

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return sourceFiles(path)
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
    })
}

let failed = false
for (const group of GROUPS) {
    let covered = 0
    let total = 0
    const rows: Array<[string, number, number]> = []
    for (const file of sourceFiles(group)) {
        const lines = hits.get(file)
        if (!lines) {
            // A file no test ever loads would silently drop out of the report: that must fail, not pass.
            console.error(`  ✗ ${file} is not loaded by any test`)
            failed = true
            continue
        }
        const fileCovered = [...lines.values()].filter(count => count > 0).length
        rows.push([file, fileCovered, lines.size])
        covered += fileCovered
        total += lines.size
    }
    const ratio = total === 0 ? 0 : covered / total
    console.log(`\n${group}: ${(ratio * 100).toFixed(1)} % of ${total} lines (floor ${THRESHOLD * 100} %)`)
    for (const [file, c, t] of rows.sort((a, b) => a[1] / a[2] - b[1] / b[2]).slice(0, 5)) {
        console.log(`    ${((c / t) * 100).toFixed(0).padStart(3)} %  ${file}`)
    }
    if (ratio < THRESHOLD) failed = true
}
if (failed) {
    console.error('\nCoverage check FAILED')
    process.exit(1)
}
console.log('\nCoverage check passed')
