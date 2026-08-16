import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

const requestedOutput = process.argv[2]
const retainedDirectory = join(rootDir, 'release-artifacts')
if (requestedOutput && resolve(requestedOutput) !== retainedDirectory) {
  throw new Error('The retained release output must be ./release-artifacts.')
}

const workingDirectory = await mkdtemp(join(tmpdir(), 'nuxt-pdf-release-artifact-'))
const outputDirectory = requestedOutput ? retainedDirectory : workingDirectory

if (requestedOutput) {
  await rm(outputDirectory, { force: true, recursive: true })
  await mkdir(outputDirectory, { recursive: true })
}

try {
  const output = execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', outputDirectory],
    {
      cwd: rootDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: join(workingDirectory, 'pack-cache'),
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
  const tarball = join(outputDirectory, basename(report.filename))
  const reportPath = join(outputDirectory, 'pack-report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)

  const sourceSha = process.env.GITHUB_SHA
    ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim()
  if (!/^[a-f0-9]{40}$/u.test(sourceSha)) {
    throw new Error('The release artifact requires an exact 40-character source commit.')
  }

  const tarballBytes = await readFile(tarball)
  const manifestPath = join(outputDirectory, 'release-artifact.json')
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    packageName: report.name,
    packageVersion: report.version,
    channel: report.version.includes('-') ? 'next' : 'latest',
    commit: sourceSha,
    tarball: basename(report.filename),
    sha1: createHash('sha1').update(tarballBytes).digest('hex'),
    sha256: createHash('sha256').update(tarballBytes).digest('hex'),
  }, null, 2)}\n`)

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

  const sbomPath = join(outputDirectory, 'nuxt-pdf.cdx.json')
  const licensesPath = join(outputDirectory, 'third-party-licenses.json')
  execFileSync(process.execPath, ['scripts/generate-sbom.mjs', sbomPath], {
    cwd: rootDir,
    stdio: 'inherit',
  })
  execFileSync(process.execPath, ['scripts/generate-license-inventory.mjs', licensesPath], {
    cwd: rootDir,
    stdio: 'inherit',
  })

  const evidence = [tarball, reportPath, manifestPath, sbomPath, licensesPath]
  const checksums = []
  for (const path of evidence) {
    const checksum = createHash('sha256').update(await readFile(path)).digest('hex')
    checksums.push(`${checksum}  ${basename(path)}`)
  }
  await writeFile(join(outputDirectory, 'SHA256SUMS'), `${checksums.join('\n')}\n`)

  console.log(requestedOutput
    ? `Retained verified release evidence in ${outputDirectory}.`
    : 'Verified the release artifact and evidence.')
}
finally {
  await rm(workingDirectory, { force: true, recursive: true })
}
