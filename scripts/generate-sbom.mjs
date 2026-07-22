import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputPath = resolve(process.argv[2] ?? 'reports/nuxt-pdf.cdx.json')
const packageJson = JSON.parse(await readFile(`${rootDir}/package.json`, 'utf8'))
const trees = JSON.parse(execFileSync(
  'pnpm',
  ['list', '--prod', '--json', '--depth', 'Infinity'],
  { cwd: rootDir, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
))

const components = new Map()

const collect = (dependencies = {}) => {
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (!dependency || typeof dependency !== 'object') continue
    const version = typeof dependency.version === 'string' ? dependency.version : 'unknown'
    const reference = `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`
    components.set(reference, {
      'bom-ref': reference,
      'name': name,
      'purl': reference,
      'type': 'library',
      'version': version,
    })
    collect(dependency.dependencies)
  }
}

for (const tree of trees) collect(tree.dependencies)

const rootReference = `pkg:npm/${encodeURIComponent(packageJson.name)}@${packageJson.version}`
const sbom = {
  bomFormat: 'CycloneDX',
  components: [...components.values()].sort((left, right) =>
    left['bom-ref'].localeCompare(right['bom-ref'])),
  metadata: {
    component: {
      'bom-ref': rootReference,
      'name': packageJson.name,
      'purl': rootReference,
      'type': 'library',
      'version': packageJson.version,
    },
    timestamp: new Date().toISOString(),
    tools: [{ name: 'nuxt-pdf release tooling', vendor: 'Lupinum' }],
  },
  serialNumber: `urn:uuid:${randomUUID()}`,
  specVersion: '1.6',
  version: 1,
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(sbom, null, 2)}\n`)
console.log(`Wrote CycloneDX SBOM with ${components.size} production components to ${outputPath}.`)
