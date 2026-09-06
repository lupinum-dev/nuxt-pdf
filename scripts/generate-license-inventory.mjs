import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageJson = JSON.parse(await readFile(resolve(rootDir, 'package.json'), 'utf8'))
const outputPath = resolve(process.argv[2] ?? 'reports/third-party-licenses.json')
const grouped = JSON.parse(execFileSync(
  'pnpm',
  ['--filter', packageJson.name, 'licenses', 'list', '--prod', '--json'],
  { cwd: rootDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
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
