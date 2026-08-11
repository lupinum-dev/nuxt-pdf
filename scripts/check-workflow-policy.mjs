import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workflowNames = ['ci.yml', 'release.yml', 'post-publish.yml']
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
const release = workflows.get('release.yml')
const postPublish = workflows.get('post-publish.yml')
const allWorkflows = [...workflows.values()].join('\n')

assert(
  (allWorkflows.match(/id-token: write/gu) ?? []).length === 1
  && release.includes('id-token: write'),
  'Only release.yml can request npm OIDC authority.',
)
assert(
  (allWorkflows.match(/contents: write/gu) ?? []).length === 1
  && postPublish.includes('contents: write'),
  'Only post-publish.yml can request repository write authority.',
)
assert(
  !ci.includes('id-token: write') && !ci.includes('contents: write'),
  'Normal CI must remain read-only.',
)

const stageJob = extractJob(release, 'stage')
assert(stageJob.includes('environment: npm'), 'The npm stage job must use the npm environment.')
assert(stageJob.includes('id-token: write'), 'The npm stage job must request OIDC authority.')
assert(!stageJob.includes('actions/checkout'), 'The npm stage job must not check out repository code.')
assert(!/\bpnpm\b/u.test(stageJob), 'The npm stage job must not run pnpm.')
assert(!/npm (?:install|ci|exec|run)\b/u.test(stageJob), 'The npm stage job must not install or run package code.')
assert(!/node scripts\//u.test(stageJob), 'The npm stage job must not run repository scripts.')
assert(
  stageJob.includes('test "${tarballs[0]}" = "$tarball"'),
  'The npm stage job must require the canonical tarball filename.',
)
assert(
  stageJob.includes('npm stage publish "$tarball"'),
  'The npm stage job must publish only the validated shell variable.',
)
assert(
  extractRunSources(stageJob).every(run => !run.includes('${{')),
  'The npm stage job must not interpolate GitHub expressions into shell source.',
)

const githubReleaseJob = extractJob(postPublish, 'release')
assert(!githubReleaseJob.includes('actions/checkout'), 'The GitHub release job must not check out repository code.')
assert(!/\bpnpm\b/u.test(githubReleaseJob), 'The GitHub release job must not run pnpm.')
assert(!/npm (?:install|ci|exec|run)\b/u.test(githubReleaseJob), 'The GitHub release job must not install or run package code.')
assert(!/node scripts\//u.test(githubReleaseJob), 'The GitHub release job must not run repository scripts.')
assert(
  extractRunSources(githubReleaseJob).every(run => !run.includes('${{')),
  'The GitHub release job must not interpolate GitHub expressions into shell source.',
)
assert(!postPublish.includes('github.sha'), 'Post-publish tags must not use the dispatch-time commit.')
assert(postPublish.includes('release_run_id:'), 'Post-publish must accept the original release run ID.')
assert(!postPublish.includes('sha256:'), 'Post-publish must derive the checksum from retained evidence.')
assert(postPublish.includes('--verify-tag'), 'GitHub Release creation must verify the source tag.')

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
