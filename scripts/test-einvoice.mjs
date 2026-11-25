// Validates the generated e-invoice XML of test/einvoice/validators.test.ts
// with the official validators. Not part of `pnpm verify`. It needs Java 17 or
// newer and the validator files below in NUXT_PDF_VALIDATORS_DIR (default
// ~/.cache/nuxt-pdf-validators), checked by SHA-256. Without them this fails
// with a message that names what is missing; it never skips and never
// downloads.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const directory = resolve(process.env.NUXT_PDF_VALIDATORS_DIR ?? join(homedir(), '.cache', 'nuxt-pdf-validators'))

const FILES = [
  {
    name: 'Mustang CLI 2.26.0',
    path: 'mustang-cli-2.26.0/Mustang-CLI-2.26.0.jar',
    sha256: '42d7868cb68264874a7b8cab4c3587b03b23ccc7cd72373da917f66758bb9736',
    env: 'NUXT_PDF_MUSTANG_JAR',
  },
  {
    name: 'KoSIT validator 1.6.3',
    path: 'kosit-validator-1.6.3/validator-1.6.3-standalone.jar',
    sha256: '799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9',
    env: 'NUXT_PDF_KOSIT_JAR',
  },
  {
    name: 'XRechnung 3.0.2 validator configuration 2026-08-31',
    path: 'xrechnung-config-2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip',
    sha256: '2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8',
    env: 'NUXT_PDF_XRECHNUNG_CONFIG',
  },
]

const sha256 = path => new Promise((resolvePromise, reject) => {
  const hash = createHash('sha256')
  createReadStream(path).on('data', chunk => hash.update(chunk)).on('end', () => resolvePromise(hash.digest('hex'))).on('error', reject)
})

const problems = []

const java = spawnSync('java', ['-version'], { encoding: 'utf8' })
const javaVersion = /version "(\d+)/.exec(java.stderr ?? '')?.[1]
if (java.error || java.status !== 0) {
  problems.push(`Java is not installed or not on PATH (${java.error?.message ?? java.stderr?.trim()}). Install Java 17 or newer.`)
}
else if (javaVersion === undefined || Number(javaVersion) < 17) {
  problems.push(`Java 17 or newer is needed; \`java -version\` says: ${java.stderr.split('\n')[0]}`)
}

const env = { ...process.env }
for (const file of FILES) {
  const path = join(directory, file.path)
  if (!existsSync(path)) {
    problems.push(`${file.name} is missing: expected ${path}`)
    continue
  }
  const actual = await sha256(path)
  if (actual !== file.sha256) {
    problems.push(`${file.name} at ${path} has SHA-256 ${actual}, expected ${file.sha256}`)
    continue
  }
  env[file.env] = path
}

if (problems.length > 0) {
  console.error([
    'pnpm test:einvoice cannot run the official e-invoice validators:',
    ...problems.map(problem => `- ${problem}`),
    `Put the files in ${directory} (or set NUXT_PDF_VALIDATORS_DIR). This script never downloads them.`,
  ].join('\n'))
  process.exit(1)
}

// The KoSIT validator reads the XRechnung configuration as a folder.
const config = mkdtempSync(join(tmpdir(), 'nuxt-pdf-xrechnung-'))
const unzip = spawnSync('unzip', ['-q', env.NUXT_PDF_XRECHNUNG_CONFIG, '-d', config], { stdio: 'inherit' })
if (unzip.status !== 0) {
  rmSync(config, { recursive: true, force: true })
  console.error(`pnpm test:einvoice could not unzip ${env.NUXT_PDF_XRECHNUNG_CONFIG} with \`unzip\`.`)
  process.exit(1)
}
env.NUXT_PDF_XRECHNUNG_CONFIG_DIR = config

const vitest = spawnSync('pnpm', ['exec', 'vitest', 'run', 'test/einvoice/validators.test.ts'], { stdio: 'inherit', env })
rmSync(config, { recursive: true, force: true })
process.exit(vitest.status ?? 1)
