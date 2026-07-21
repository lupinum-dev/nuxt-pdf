import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))

const readRootFile = path => readFile(join(rootDir, path), 'utf8')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const packageJson = JSON.parse(await readRootFile('package.json'))
const [changelog, conformance] = await Promise.all([
  readRootFile('CHANGELOG.md'),
  readRootFile('CONFORMANCE.md'),
])

assert(
  /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i.test(packageJson.version),
  `package.json contains an invalid release version: ${packageJson.version}.`,
)

const currentChangelogVersion = changelog.match(/^## (\S+)$/m)?.[1]
assert(
  currentChangelogVersion === packageJson.version,
  `CHANGELOG.md starts with ${currentChangelogVersion ?? 'no release'}; expected ${packageJson.version}.`,
)

assert(
  conformance.startsWith(`# Nuxt PDF ${packageJson.version} conformance\n`),
  `CONFORMANCE.md does not describe package version ${packageJson.version}.`,
)

assert(
  conformance.includes(`| Layer | ${packageJson.version} boundary |`),
  `CONFORMANCE.md has no ${packageJson.version} version boundary.`,
)

console.log(`Release metadata matches ${packageJson.name}@${packageJson.version}.`)
