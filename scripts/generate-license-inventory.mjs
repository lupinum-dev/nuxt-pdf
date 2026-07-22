import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const outputPath = resolve(process.argv[2] ?? 'reports/third-party-licenses.json')
const grouped = JSON.parse(execFileSync(
  'pnpm',
  ['licenses', 'list', '--prod', '--json'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
))

const packages = Object.entries(grouped).flatMap(([license, entries]) =>
  entries.map(entry => ({
    author: entry.author ?? null,
    homepage: entry.homepage ?? null,
    license,
    name: entry.name,
    versions: [...entry.versions].sort(),
  })))
  .sort((left, right) => left.name.localeCompare(right.name)
    || left.license.localeCompare(right.license))

if (packages.some(entry => !entry.license || entry.license === 'UNKNOWN')) {
  throw new Error('The production dependency graph contains a package without identified license metadata.')
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify({ packages }, null, 2)}\n`)
console.log(`Wrote ${packages.length} production license records to ${outputPath}.`)
