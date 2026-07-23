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

const changelogVersions = [
  ...changelog.matchAll(/^## (\S+)(?: - \d{4}-\d{2}-\d{2})?$/gm),
]
  .map(match => match[1])
const currentChangelogVersion = changelogVersions.find(version => version !== 'Unreleased')
assert(
  currentChangelogVersion === packageJson.version,
  `CHANGELOG.md's newest release is ${currentChangelogVersion ?? 'missing'}; expected ${packageJson.version}.`,
)

assert(
  conformance.startsWith(`# Nuxt PDF ${packageJson.version} conformance\n`),
  `CONFORMANCE.md does not describe package version ${packageJson.version}.`,
)

assert(
  conformance.includes(`| Layer | ${packageJson.version} boundary |`),
  `CONFORMANCE.md has no ${packageJson.version} version boundary.`,
)

console.log(`Version headings match ${packageJson.name}@${packageJson.version}.`)
