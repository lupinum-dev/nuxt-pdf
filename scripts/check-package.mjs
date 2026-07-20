import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageJson = JSON.parse(
  await readFile(join(rootDir, 'package.json'), 'utf8'),
)
const expectedRelease = {
  name: '@lupinum/nuxt-pdf',
  version: '0.1.0',
}

const requiredFiles = [
  'CONFORMANCE.md',
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'dist/module.d.mts',
  'dist/module.json',
  'dist/module.mjs',
  'dist/runtime/components/index.js',
  'dist/runtime/renderer/index.js',
  'dist/runtime/server/index.js',
  'dist/runtime/shared/index.js',
  'dist/types.d.mts',
  'package.json',
]

const forbiddenPrefixes = [
  '.git/',
  '.nuxt/',
  '.output/',
  'node_modules/',
  'playground/',
  'src/',
  'test/',
  'tmp/',
]

const textExtensions = new Set([
  '.cts',
  '.json',
  '.md',
  '.mjs',
  '.mts',
  '.ts',
])

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const parsePackReport = (output) => {
  for (let index = output.lastIndexOf('['); index >= 0; index = output.lastIndexOf('[', index - 1)) {
    try {
      const report = JSON.parse(output.slice(index))
      if (Array.isArray(report) && report.length === 1) return report[0]
    }
    catch {
      // Lifecycle output can precede npm's JSON report.
    }
  }

  throw new Error(`npm pack did not return a usable JSON report:\n${output}`)
}

const readTarEntry = (tarball, path) => execFileSync(
  'tar',
  ['-xOf', tarball, `package/${path}`],
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
)

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'nuxt-pdf-pack-'))

try {
  const output = execFileSync(
    'npm',
    ['pack', '--json', '--pack-destination', temporaryDirectory],
    {
      cwd: rootDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: join(temporaryDirectory, 'npm-cache'),
        npm_config_loglevel: 'silent',
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  const report = parsePackReport(output)
  const tarball = join(temporaryDirectory, basename(report.filename))
  const files = report.files.map(file => file.path).sort()
  const fileSet = new Set(files)

  assert(packageJson.name === expectedRelease.name, `Release package name is ${packageJson.name}; expected ${expectedRelease.name}.`)
  assert(packageJson.version === expectedRelease.version, `Release version is ${packageJson.version}; expected ${expectedRelease.version}.`)
  assert(report.name === packageJson.name, `Packed name is ${report.name}; expected ${packageJson.name}.`)
  assert(report.version === packageJson.version, `Packed version is ${report.version}; expected ${packageJson.version}.`)
  assert(report.entryCount === files.length, 'npm pack reported an inconsistent entry count.')

  for (const path of requiredFiles) {
    assert(fileSet.has(path), `Packed artifact is missing ${path}.`)
  }

  for (const path of files) {
    assert(
      !path.startsWith('/') && !path.split('/').includes('..'),
      `Packed artifact contains an unsafe path: ${path}.`,
    )
    assert(
      !forbiddenPrefixes.some(prefix => path.startsWith(prefix)),
      `Packed artifact contains a development-only path: ${path}.`,
    )
  }

  const packedPackageJson = JSON.parse(readTarEntry(tarball, 'package.json'))
  const importTarget = packedPackageJson.exports?.['.']?.import?.replace(/^\.\//, '')
  const typeTarget = packedPackageJson.exports?.['.']?.types?.replace(/^\.\//, '')

  assert(packedPackageJson.name === packageJson.name, 'Packed package.json has the wrong name.')
  assert(packedPackageJson.version === packageJson.version, 'Packed package.json has the wrong version.')
  assert(packedPackageJson.private !== true, 'Packed package.json must be publishable.')
  assert(packedPackageJson.publishConfig?.access === 'public', 'Scoped package must publish with public access.')
  assert(importTarget && fileSet.has(importTarget), `Package export target is missing: ${importTarget}.`)
  assert(typeTarget && fileSet.has(typeTarget), `Package type target is missing: ${typeTarget}.`)

  const repositoryPath = `${rootDir}${sep}`
  const forbiddenScaffoldText = [
    '# My Module',
    'My new Nuxt module',
    'my-module',
    'your-org',
  ]

  for (const path of files) {
    const extension = path.slice(path.lastIndexOf('.'))
    if (!textExtensions.has(extension)) continue

    const contents = readTarEntry(tarball, path)
    assert(
      !contents.includes(repositoryPath) && !contents.includes(rootDir),
      `Packed file leaks the local repository path: ${path}.`,
    )

    for (const text of forbiddenScaffoldText) {
      assert(!contents.includes(text), `Packed file still contains starter text ${JSON.stringify(text)}: ${path}.`)
    }
  }

  console.log(`Verified ${packageJson.name}@${packageJson.version} package contents (${files.length} files).`)
}
finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}
