import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseChangelogMarkdown } from 'changelogen'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const arguments_ = process.argv.slice(2)
if (arguments_[0] === '--') arguments_.shift()
const [version, outputPath] = arguments_

if (!/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i.test(version ?? '')) {
  throw new Error('Pass an exact semantic version as the first argument.')
}

if (!outputPath) {
  throw new Error('Pass the release-notes output path as the second argument.')
}

const [packageJsonSource, changelog] = await Promise.all([
  readFile(join(rootDir, 'package.json'), 'utf8'),
  readFile(join(rootDir, 'CHANGELOG.md'), 'utf8'),
])
const packageJson = JSON.parse(packageJsonSource)

if (packageJson.version !== version) {
  throw new Error(
    `package.json is ${packageJson.version}; expected release version ${version}.`,
  )
}

const matches = parseChangelogMarkdown(changelog).releases.filter(
  release => release.version === version,
)

if (matches.length !== 1 || !matches[0].body) {
  throw new Error(
    `CHANGELOG.md must contain exactly one non-empty ${version} release.`,
  )
}

const destination = resolve(rootDir, outputPath)
await mkdir(dirname(destination), { recursive: true })
await writeFile(destination, `${matches[0].body.trim()}\n`)

console.log(`Wrote GitHub release notes for ${version} to ${destination}.`)
