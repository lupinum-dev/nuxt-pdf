import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))

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

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'nuxt-pdf-release-artifact-'))

try {
  const output = execFileSync(
    'npm',
    ['pack', '--json', '--pack-destination', temporaryDirectory],
    {
      cwd: rootDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: join(temporaryDirectory, 'pack-cache'),
        npm_config_loglevel: 'silent',
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  const report = parsePackReport(output)
  const performanceBaseline = JSON.parse(await readFile(
    join(rootDir, 'test', 'fixtures', 'performance', 'linux-node24.json'),
    'utf8',
  ))
  if (report.size > performanceBaseline.packageTarballBytes * 1.1) {
    throw new Error(`Package tarball size regressed from ${performanceBaseline.packageTarballBytes} to ${report.size} bytes.`)
  }
  if (report.unpackedSize > performanceBaseline.packageUnpackedBytes * 1.1) {
    throw new Error(`Unpacked package size regressed from ${performanceBaseline.packageUnpackedBytes} to ${report.unpackedSize} bytes.`)
  }
  const tarball = join(temporaryDirectory, basename(report.filename))
  const reportPath = join(temporaryDirectory, 'pack-report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  const env = {
    ...process.env,
    NUXT_PDF_PACK_REPORT: reportPath,
    NUXT_PDF_TARBALL: tarball,
  }
  execFileSync('pnpm', ['exec', 'publint', tarball], {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  })
  execFileSync('pnpm', ['exec', 'attw', tarball, '--profile', 'esm-only'], {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  })
  execFileSync(process.execPath, ['scripts/check-package.mjs'], {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  })
  execFileSync(process.execPath, ['scripts/test-package-quickstart.mjs'], {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  })
}
finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}
