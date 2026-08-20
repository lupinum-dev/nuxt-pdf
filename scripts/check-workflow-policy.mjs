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
const allWorkflows = [...workflows.values()].join('\n')

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
assert(release.includes('head_sha=$GITHUB_SHA'), 'The release workflow must find successful CI for the exact main commit.')
assert(verifyCandidateJob.includes('actions: read'), 'Candidate verification must read the selected CI artifact.')
assert(verifyCandidateJob.includes('release-candidate'), 'Candidate verification must download the main CI artifact.')
assert(verifyCandidateJob.includes('verified-release'), 'Candidate verification must retain the same verified bytes.')
assert(!verifyCandidateJob.includes('actions/checkout'), 'Candidate verification must not check out source.')
assert(!/\bpnpm\b/u.test(verifyCandidateJob), 'Candidate verification must not rebuild the package.')
assert(!/npm (?:install|ci|exec|run)\b/u.test(verifyCandidateJob), 'Candidate verification must not install or run package code.')
assert(publishJob.includes('environment: npm'), 'The npm publish job must use the npm environment.')
assert(publishJob.includes('id-token: write'), 'The npm publish job must request OIDC authority.')
assert(!publishJob.includes('actions/checkout'), 'The npm publish job must not check out repository code.')
assert(!/\bpnpm\b/u.test(publishJob), 'The npm publish job must not run pnpm.')
assert(!/npm (?:install|ci|exec|run)\b/u.test(publishJob), 'The npm publish job must not install or run package code.')
assert(!/node scripts\//u.test(publishJob), 'The npm publish job must not run repository scripts.')
assert(
  publishJob.includes('test "${tarballs[0]}" = "$tarball"'),
  'The npm publish job must require the canonical tarball filename.',
)
assert(
  publishJob.includes('npm publish "$tarball"'),
  'The npm publish job must publish only the validated shell variable.',
)
assert(publishJob.includes('dist.shasum'), 'The npm publish job must verify exact registry bytes.')
assert(publishJob.includes('dist.attestations'), 'The npm publish job must require provenance.')
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
assert(githubReleaseJob.includes('needs: publish'), 'The GitHub release must wait for npm publication.')
assert(githubReleaseJob.includes('sha256sum --check SHA256SUMS'), 'The GitHub release must verify retained checksums.')
assert(githubReleaseJob.includes('gh release create'), 'The protected workflow must create the GitHub release.')
assert(githubReleaseJob.includes('gh release edit'), 'The protected workflow must safely repair an existing matching release.')

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
