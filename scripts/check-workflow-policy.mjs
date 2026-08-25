import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workflowNames = ['ci.yml', 'release.yml']
const workflows = new Map(await Promise.all(workflowNames.map(async name => [
  name,
  await readFile(join(rootDir, '.github/workflows', name), 'utf8'),
])))

const errors = []
const assert = (condition, message) => {
  if (!condition) errors.push(message)
}

for (const [name, source] of workflows) {
  const useSteps = extractUseSteps(source)
  for (const step of useSteps) {
    const action = step.action
    if (action.startsWith('./')) continue
    assert(
      /@[a-f0-9]{40}$/u.test(action),
      `${name}: pin ${action} to a full commit SHA.`,
    )
  }

  const checkoutSteps = useSteps.filter(step => step.action.startsWith('actions/checkout@'))
  assert(
    checkoutSteps.every(step => step.source.includes('persist-credentials: false')),
    `${name}: every checkout must disable persisted credentials.`,
  )

  assert(
    !/\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b/u.test(source),
    `${name}: publication tokens are forbidden.`,
  )
}

const ci = workflows.get('ci.yml')
const ciConfig = parse(ci)
const release = workflows.get('release.yml')
const releaseConfig = parse(release)
const allWorkflows = [...workflows.values()].join('\n')
const recoverySource = await readFile(join(rootDir, 'scripts/verify-npm-recovery.mjs'), 'utf8')
const packageJson = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'))
const lockSource = await readFile(join(rootDir, 'pnpm-lock.yaml'), 'utf8')
const sigstoreManifest = JSON.parse(
  await readFile(join(rootDir, 'scripts/sigstore-verifier/package.json'), 'utf8'),
)
const sigstoreLock = JSON.parse(
  await readFile(join(rootDir, 'scripts/sigstore-verifier/package-lock.json'), 'utf8'),
)

assert(
  (allWorkflows.match(/id-token: write/gu) ?? []).length === 1
  && release.includes('id-token: write'),
  'Only release.yml can request npm OIDC authority.',
)
assert(
  (allWorkflows.match(/contents: write/gu) ?? []).length === 1
  && release.includes('contents: write'),
  'Only release.yml can request repository write authority.',
)
assert(
  !ci.includes('id-token: write') && !ci.includes('contents: write'),
  'Normal CI must remain read-only.',
)
assert(ci.includes('node scripts/verify-action-shas.mjs'), 'CI must verify pinned Action commits upstream.')
assert(!ci.includes('GITHUB_TOKEN'), 'Action verification must not receive GITHUB_TOKEN.')
const classifyScript = ciConfig.jobs.classify.steps.find(
  step => step.name === 'Select required lanes',
)?.with?.script
assert(typeof classifyScript === 'string', 'CI must classify expensive pull-request lanes.')
const ciGate = ciConfig.jobs.gate
const classifiedJobs = ['quality', 'core', 'raster', 'nuxt-integration', 'windows', 'package']
assert(
  ciGate.if === 'always()'
  && ciGate.name === 'CI gate'
  && classifiedJobs.every(job => ciGate.needs.includes(job)),
  'CI must expose one always-reported gate for every classified lane.',
)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
for (const scenario of [
  { name: 'public docs', event: 'pull_request', paths: ['docs/content/1.index.md'], full: 'false', quality: 'true' },
  { name: 'top-level prose', event: 'pull_request', paths: ['README.md'], full: 'false', quality: 'false' },
  { name: 'compiler source', event: 'pull_request', paths: ['src/runtime/compiler.ts'], full: 'true', quality: 'true' },
  { name: 'workflow policy', event: 'pull_request', paths: ['.github/workflows/ci.yml'], full: 'true', quality: 'true' },
  { name: 'main certification', event: 'push', paths: [], full: 'true', quality: 'true' },
]) {
  const outputs = new Map()
  await new AsyncFunction('context', 'github', 'core', classifyScript)(
    { eventName: scenario.event, issue: { number: 1 }, repo: { owner: 'lupinum-dev', repo: 'nuxt-pdf' } },
    {
      paginate: async () => scenario.paths.map(filename => ({ filename })),
      rest: { pulls: { listFiles() {} } },
    },
    { setOutput: (name, value) => outputs.set(name, value) },
  )
  assert(
    outputs.get('full') === scenario.full && outputs.get('quality') === scenario.quality,
    `CI classification failed the ${scenario.name} fixture.`,
  )
}

const publishJob = extractJob(release, 'publish')
const verifyCandidateJob = extractJob(release, 'verify-candidate')
assert(
  release.includes('head_sha=$GITHUB_SHA'),
  'The current main workflow definition must have successful push CI.',
)
assert(
  release.includes('head_sha=$RELEASE_SOURCE_SHA'),
  'The release workflow must find successful CI for the exact certified source.',
)
assert(verifyCandidateJob.includes('actions: read'), 'Candidate verification must read the selected CI artifact.')
assert(verifyCandidateJob.includes('release-candidate'), 'Candidate verification must download the main CI artifact.')
assert(verifyCandidateJob.includes('verified-release'), 'Candidate verification must retain the same verified bytes.')
assert(!/\bpnpm\b/u.test(verifyCandidateJob), 'Candidate verification must not rebuild the package.')
assert(
  verifyCandidateJob.includes('scripts/sigstore-verifier/package.json')
  && verifyCandidateJob.includes('scripts/sigstore-verifier/package-lock.json')
  && verifyCandidateJob.includes('npm ci --prefix "$SIGSTORE_PREFIX"')
  && verifyCandidateJob.includes('--ignore-scripts --no-audit --no-fund'),
  'Candidate verification must install only the isolated locked Sigstore verifier.',
)
assert(!/npm (?:install|exec|run)\b/u.test(verifyCandidateJob), 'Candidate verification must not install or run package code.')
assert(
  verifyCandidateJob.includes('node scripts/verify-npm-recovery.mjs --resolve-source')
  && verifyCandidateJob.includes('compare/$RELEASE_SOURCE_SHA...$GITHUB_SHA')
  && verifyCandidateJob.includes('m.commit!==process.env.RELEASE_SOURCE_SHA'),
  'Recovery must derive the signed source, require it on main, and select its exact artifact.',
)
assert(packageJson.devDependencies?.sigstore === undefined, 'Sigstore must stay outside the workspace graph.')
assert(!lockSource.includes('sigstore@5.0.0'), 'Sigstore must not enter the workspace lockfile.')
assert(
  sigstoreManifest.private === true && sigstoreManifest.dependencies?.sigstore === '5.0.0',
  'The isolated verifier manifest must pin Sigstore 5.0.0.',
)
assert(
  sigstoreLock.lockfileVersion === 3
  && sigstoreLock.packages?.['']?.dependencies?.sigstore === '5.0.0'
  && sigstoreLock.packages?.['node_modules/sigstore']?.version === '5.0.0',
  'The isolated verifier lockfile must pin Sigstore 5.0.0.',
)
for (const [path, dependency] of Object.entries(sigstoreLock.packages ?? {})) {
  if (!path) continue
  assert(
    typeof dependency.resolved === 'string'
    && dependency.resolved.startsWith('https://registry.npmjs.org/')
    && dependency.integrity?.startsWith('sha512-'),
    `The isolated verifier dependency ${path} must have registry and integrity pins.`,
  )
}
for (const required of [
  `version !== '5.0.0'`,
  'verifyBundle ?? loadSigstoreVerifier()',
  'certificateIdentityURI',
  `'1.3.6.1.4.1.57264.1.3': sourceSha`,
  'subjects[0]?.digest?.sha512 !== tarballSha512',
  'url.origin !== REGISTRY_URL',
  'url.username',
  `redirect: 'error'`,
  'AbortSignal.timeout(15_000)',
]) {
  assert(recoverySource.includes(required), `Cryptographic recovery is missing ${required}.`)
}
assert(publishJob.includes('environment: npm'), 'The npm publish job must use the npm environment.')
assert(
  Object.keys(releaseConfig.on?.workflow_dispatch?.inputs ?? {}).join(',') === 'version',
  'Release dispatch must accept only the explicit version.',
)
assert(
  releaseConfig.jobs?.publish?.if === 'needs.verify-candidate.outputs.publish-required == \'true\'',
  'The npm environment must be skipped when the certified bytes already exist.',
)
assert(publishJob.includes('id-token: write'), 'The npm publish job must request OIDC authority.')
assert(!publishJob.includes('actions/checkout'), 'The npm publish job must not check out repository code.')
assert(!/\bpnpm\b/u.test(publishJob), 'The npm publish job must not run pnpm.')
assert(!/npm (?:install|ci|exec|run)\b/u.test(publishJob), 'The npm publish job must not install or run package code.')
assert(!/node scripts\//u.test(publishJob), 'The npm publish job must not run repository scripts.')
assert(
  publishJob.includes('manifest.tarball !== expectedTarball'),
  'The npm publish job must require the canonical tarball filename.',
)
assert(
  publishJob.includes(`run(['publish', tarball`),
  'The npm publish job must publish only the validated tarball variable.',
)
assert(publishJob.includes('dist.shasum'), 'The npm publish job must verify exact registry bytes.')
assert(
  publishJob.includes('/E404|404 Not Found/.test(result.stderr)'),
  'The npm publish job must ignore npm JSON errors for missing versions.',
)
assert(publishJob.includes('dist.attestations'), 'The npm publish job must require provenance.')
assert(
  publishJob.includes('registry-verification.json')
  && publishJob.includes('record.sourceSha !== manifest.commit')
  && publishJob.includes('existing !== record.registryShasum')
  && publishJob.includes('registry existence or bytes changed after verification'),
  'The protected job must enforce the unprivileged registry record and reject races.',
)
for (const forbidden of ['sigstore', 'signedAccessSignatureUrl', 'dsseEnvelope']) {
  assert(!publishJob.includes(forbidden), `The privileged job must not contain ${forbidden}.`)
}
assert(
  publishJob.includes(`url.origin !== 'https://registry.npmjs.org'`)
  && publishJob.includes(`url.pathname.startsWith('/-/npm/v1/attestations/')`)
  && publishJob.includes('url.username || url.password || url.search || url.hash')
  && publishJob.includes(`redirect: 'error'`)
  && publishJob.includes('AbortSignal.timeout(15000)')
  && publishJob.includes(`createHash('sha256').update(JSON.stringify(candidates[0].bundle))`)
  && publishJob.includes('registry provenance changed after verification'),
  'The protected job must bind current registry provenance to the verified bundle.',
)
assert(
  extractRunSources(publishJob).every(run => !run.includes('${{')),
  'The npm publish job must not interpolate GitHub expressions into shell source.',
)

const githubReleaseJob = extractJob(release, 'github-release')
assert(!githubReleaseJob.includes('actions/checkout'), 'The GitHub release job must not check out repository code.')
assert(!/\bpnpm\b/u.test(githubReleaseJob), 'The GitHub release job must not run pnpm.')
assert(!/npm (?:install|ci|exec|run)\b/u.test(githubReleaseJob), 'The GitHub release job must not install or run package code.')
assert(!/node scripts\//u.test(githubReleaseJob), 'The GitHub release job must not run repository scripts.')
assert(
  extractRunSources(githubReleaseJob).every(run => !run.includes('${{')),
  'The GitHub release job must not interpolate GitHub expressions into shell source.',
)
assert(
  githubReleaseJob.includes('needs: [verify-candidate, publish]')
  && githubReleaseJob.includes('needs.publish.result == \'skipped\''),
  'The GitHub release must support repair after a verified npm no-op.',
)
assert(githubReleaseJob.includes('sha256sum --check SHA256SUMS'), 'The GitHub release must verify retained checksums.')
assert(githubReleaseJob.includes('gh release create'), 'The protected workflow must create the GitHub release.')
assert(githubReleaseJob.includes('gh release edit'), 'The protected workflow must safely repair an existing matching release.')
assert(
  githubReleaseJob.includes('registry-verification.json')
  && githubReleaseJob.includes('manifest_source')
  && githubReleaseJob.includes('while test "$tag_type" = tag')
  && githubReleaseJob.includes('prerelease_edit=(--prerelease=false)'),
  'GitHub release repair must use the certified source, peel tags, and repair channel state.',
)
assert(
  githubReleaseJob.includes('gh api --silent --method POST')
  && githubReleaseJob.includes('-f sha="$manifest_source"')
  && githubReleaseJob.includes('--verify-tag')
  && githubReleaseJob.includes('HUMAN-ONLY:')
  && githubReleaseJob.includes('HTTP 403')
  && !githubReleaseJob.includes('--target'),
  'Missing tags must be atomically created and verified before Release creation.',
)

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
}
else {
  console.log('GitHub workflow policy: ok')
}

function extractJob(source, name) {
  const lines = source.split('\n')
  const start = lines.findIndex(line => line === `  ${name}:`)
  if (start === -1) return ''

  const end = lines.findIndex((line, index) => (
    index > start && line.startsWith('  ') && !line.startsWith('    ') && line.endsWith(':')
  ))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

function extractRunSources(job) {
  const lines = job.split('\n')
  const runs = []

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trimStart()
    if (!trimmed.startsWith('run:')) continue
    const indentation = lines[index].length - trimmed.length
    const source = [trimmed.slice('run:'.length).trimStart()]

    while (index + 1 < lines.length) {
      const next = lines[index + 1]
      const nextIndentation = next.length - next.trimStart().length
      if (next.trim() && nextIndentation <= indentation) break
      source.push(next)
      index += 1
    }

    runs.push(source.join('\n'))
  }

  return runs
}

function extractUseSteps(source) {
  const lines = source.split('\n')
  const steps = []

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trimStart()
    if (!trimmed.startsWith('- uses: ')) continue
    const indentation = lines[index].length - trimmed.length
    const action = trimmed.slice('- uses: '.length).split(' ')[0]
    const step = [lines[index]]

    while (index + 1 < lines.length) {
      const next = lines[index + 1]
      const nextIndentation = next.length - next.trimStart().length
      if (next.trim() && nextIndentation <= indentation) break
      step.push(next)
      index += 1
    }

    steps.push({ action, source: step.join('\n') })
  }

  return steps
}
