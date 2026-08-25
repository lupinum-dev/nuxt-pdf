import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '..')
const workflow = parse(readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8'))

const stepProgram = (jobName, stepName) => {
  const program = workflow.jobs?.[jobName]?.steps?.find(step => step.name === stepName)?.run
  assert.equal(typeof program, 'string', `Missing ${jobName} step ${stepName}.`)
  return program
}

const protectedRun = stepProgram('publish', 'Publish or verify the certified tarball').trim()
const protectedMatch = /^node --input-type=module <<'NODE'\n([\s\S]+)\nNODE$/u.exec(protectedRun)
assert(protectedMatch, 'The protected release program must remain extractable for fixtures.')
const protectedProgram = protectedMatch[1]
const fastProtectedProgram = protectedProgram
  .replace('attempt < 240', 'attempt < 1')
  .replace(
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000)',
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 0)',
  )
assert.notEqual(fastProtectedProgram, protectedProgram, 'The polling fixture must run once.')
const fixtureProtectedProgram = `
globalThis.fetch = async (_url, options) => {
  if (options?.redirect !== 'error' || !(options?.signal instanceof AbortSignal)) {
    throw new Error('Protected provenance fetch is not redirect-safe and bounded.')
  }
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(process.env.ATTESTATION_FIXTURE),
  }
}
${fastProtectedProgram}
`

const sourceSha = 'a'.repeat(40)
const currentMainSha = 'c'.repeat(40)
const releaseVersion = '1.2.3-beta.1'
const packageName = '@lupinum/nuxt-pdf'
const tarball = 'lupinum-nuxt-pdf-1.2.3-beta.1.tgz'
const tarballBytes = Buffer.from('certified nuxt pdf tarball')
const tarballSha1 = createHash('sha1').update(tarballBytes).digest('hex')
const tarballSha512 = createHash('sha512').update(tarballBytes).digest('hex')

const fakeNpmSource = `#!/usr/bin/env node
const { readFileSync } = require('node:fs');
const fixture = JSON.parse(readFileSync(process.env.NPM_FIXTURE, 'utf8'));
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('11.18.0\\n');
  process.exit(0);
}
if (args[0] === 'view') {
  const key = args[1] + ' ' + args[2];
  if (!Object.hasOwn(fixture.views, key)) {
    process.stderr.write('Unexpected npm view: ' + key + '\\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(fixture.views[key]));
  process.exit(0);
}
process.stderr.write('Unexpected npm command: ' + args.join(' ') + '\\n');
process.exit(2);
`

const provenance = {
  url: `https://registry.npmjs.org/-/npm/v1/attestations/${packageName}@${releaseVersion}`,
  provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
}
const provenanceBundle = { mediaType: 'fixture', dsseEnvelope: { payload: 'verified' } }
const provenanceDocument = {
  attestations: [{
    predicateType: 'https://slsa.dev/provenance/v1',
    bundle: provenanceBundle,
  }],
}
const provenanceBundleSha256 = createHash('sha256')
  .update(JSON.stringify(provenanceBundle))
  .digest('hex')

const runProtected = ({
  attestationDocument = provenanceDocument,
  attestations = provenance,
  recordChange,
  registryShasum = tarballSha1,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'nuxt-pdf-protected-release-'))
  try {
    const releaseDir = join(directory, 'release-artifacts')
    const binDir = join(directory, 'bin')
    mkdirSync(releaseDir)
    mkdirSync(binDir)

    const manifest = {
      packageName,
      packageVersion: releaseVersion,
      commit: sourceSha,
      tarball,
    }
    const record = {
      schemaVersion: 1,
      packageName,
      packageVersion: releaseVersion,
      sourceSha,
      tarball,
      tarballSha1,
      tarballSha512,
      registryState: 'verified-existing',
      registryShasum: tarballSha1,
      provenanceBundleSha256,
    }
    recordChange?.(record)
    writeFileSync(join(releaseDir, 'release-artifact.json'), JSON.stringify(manifest))
    writeFileSync(join(releaseDir, 'registry-verification.json'), JSON.stringify(record))
    writeFileSync(join(releaseDir, tarball), tarballBytes)

    const spec = `${packageName}@${releaseVersion}`
    const npmFixture = join(directory, 'npm-fixture.json')
    writeFileSync(npmFixture, JSON.stringify({
      views: {
        [`${spec} version`]: releaseVersion,
        [`${spec} dist.shasum`]: registryShasum,
        [`${spec} dist.attestations`]: attestations,
        [`${packageName} dist-tags.next`]: releaseVersion,
      },
    }))
    const fakeNpm = join(binDir, 'npm')
    writeFileSync(fakeNpm, fakeNpmSource)
    chmodSync(fakeNpm, 0o755)

    return spawnSync(process.execPath, ['--input-type=module', '--eval', fixtureProtectedProgram], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        ATTESTATION_FIXTURE: JSON.stringify(attestationDocument),
        NPM_FIXTURE: npmFixture,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
        RELEASE_VERSION: releaseVersion,
      },
    })
  }
  finally {
    rmSync(directory, { recursive: true })
  }
}

const completeRegistry = runProtected({})
assert.equal(completeRegistry.status, 0, completeRegistry.stderr)

for (const incomplete of [{}, { url: provenance.url }, { provenance: provenance.provenance }]) {
  const incompleteRegistry = runProtected({ attestations: incomplete })
  assert.notEqual(incompleteRegistry.status, 0, 'Incomplete provenance metadata must fail.')
  assert.match(incompleteRegistry.stderr, /provenance metadata is incomplete/u)
}

for (const url of [
  'https://user@registry.npmjs.org/-/npm/v1/attestations/fixture',
  'https://registry.npmjs.org:444/-/npm/v1/attestations/fixture',
  'https://registry.npmjs.org/-/npm/v1/attestations/fixture?token=secret',
  'https://registry.npmjs.org/-/npm/v1/attestations/fixture#fragment',
]) {
  const invalidUrl = runProtected({ attestations: { ...provenance, url } })
  assert.notEqual(invalidUrl.status, 0, 'Unsafe provenance URLs must fail closed.')
  assert.match(invalidUrl.stderr, /outside the registry attestation API/u)
}

const changedProvenance = runProtected({
  attestationDocument: {
    attestations: [{
      predicateType: 'https://slsa.dev/provenance/v1',
      bundle: { mediaType: 'fixture', dsseEnvelope: { payload: 'changed' } },
    }],
  },
})
assert.notEqual(changedProvenance.status, 0, 'A provenance bundle race must fail closed.')
assert.match(changedProvenance.stderr, /registry provenance changed after verification/u)

const duplicateProvenance = runProtected({
  attestationDocument: {
    attestations: [
      provenanceDocument.attestations[0],
      provenanceDocument.attestations[0],
    ],
  },
})
assert.notEqual(duplicateProvenance.status, 0, 'Multiple provenance bundles must fail closed.')
assert.match(duplicateProvenance.stderr, /no unique provenance bundle/u)

const changedRegistry = runProtected({ registryShasum: 'd'.repeat(40) })
assert.notEqual(changedRegistry.status, 0, 'A registry race must stop protected publication.')
assert.match(changedRegistry.stderr, /registry existence or bytes changed after verification/u)

const wrongSource = runProtected({
  recordChange: record => (record.sourceSha = currentMainSha),
})
assert.notEqual(wrongSource.status, 0, 'The protected record must retain the artifact source.')
assert.match(wrongSource.stderr, /Registry verification record does not match/u)

const unverifiedRecord = runProtected({
  recordChange: record => (record.provenanceBundleSha256 = null),
})
assert.notEqual(unverifiedRecord.status, 0, 'Existing bytes require a provenance verification hash.')

const githubReleaseProgram = stepProgram(
  'github-release',
  'Create or repair the release from certified evidence',
)
const fakeGhSource = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const fixture = JSON.parse(readFileSync(process.env.GH_FIXTURE, 'utf8'));
const args = process.argv.slice(2);
appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'api') {
  const endpoint = args.find(value => value.startsWith('repos/')) || '';
  const methodIndex = args.indexOf('--method');
  const method = methodIndex === -1 ? 'GET' : args[methodIndex + 1];
  if (method === 'POST' && endpoint.endsWith('/git/refs')) {
    if (fixture.postForbidden) {
      process.stderr.write('Resource not accessible by integration (HTTP 403)\\n');
      process.exit(1);
    }
    if (fixture.postConflict) {
      fixture.tag = fixture.postConflict;
      writeFileSync(process.env.GH_FIXTURE, JSON.stringify(fixture));
      process.stderr.write('tag already exists\\n');
      process.exit(1);
    }
    if (fixture.tag) process.exit(1);
    const ref = args.find(value => value.startsWith('ref='));
    const sha = args.find(value => value.startsWith('sha='));
    if (!ref || sha !== 'sha=${sourceSha}') process.exit(2);
    fixture.tag = { type: 'commit', sha: '${sourceSha}' };
    writeFileSync(process.env.GH_FIXTURE, JSON.stringify(fixture));
    process.exit(0);
  }
  if (endpoint.includes('/git/matching-refs/tags/')) {
    if (fixture.tag) process.stdout.write(fixture.tag.type + '\\t' + fixture.tag.sha + '\\n');
    process.exit(0);
  }
  if (endpoint.includes('/git/ref/tags/')) {
    if (!fixture.tag) process.exit(1);
    process.stdout.write(fixture.tag.type + '\\t' + fixture.tag.sha + '\\n');
    process.exit(0);
  }
  const tagObject = endpoint.match(/\\/git\\/tags\\/([0-9a-f]+)$/);
  if (tagObject && fixture.peeled[tagObject[1]]) {
    const target = fixture.peeled[tagObject[1]];
    process.stdout.write(target.type + '\\t' + target.sha + '\\n');
    process.exit(0);
  }
  process.stderr.write('Unexpected gh api endpoint: ' + endpoint + '\\n');
  process.exit(2);
}
if (args[0] === 'release' && args[1] === 'view') process.exit(fixture.releaseExists ? 0 : 1);
if (args[0] === 'release' && ['upload', 'edit'].includes(args[1])) process.exit(0);
if (args[0] === 'release' && args[1] === 'create') process.exit(args.includes('--verify-tag') ? 0 : 2);
process.stderr.write('Unexpected gh command: ' + args.join(' ') + '\\n');
process.exit(2);
`
const fakeCurlSource = `#!/usr/bin/env node
const { readFileSync } = require('node:fs');
const fixture = JSON.parse(readFileSync(process.env.GH_FIXTURE, 'utf8'));
process.stdout.write(String(fixture.releaseStatus ?? (fixture.releaseExists ? 200 : 404)));
`

const writeChecksums = (directory, files) => {
  const lines = files.map((file) => {
    const checksum = createHash('sha256').update(readFileSync(join(directory, file))).digest('hex')
    return `${checksum}  ${file}`
  })
  writeFileSync(join(directory, 'SHA256SUMS'), `${lines.join('\n')}\n`)
}

const runGithubRelease = ({
  version,
  tag,
  peeled = {},
  postConflict,
  postForbidden = false,
  releaseExists,
  releaseStatus,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'nuxt-pdf-github-release-'))
  try {
    const releaseDir = join(directory, 'release-artifacts')
    const binDir = join(directory, 'bin')
    mkdirSync(releaseDir)
    mkdirSync(binDir)
    const filename = `lupinum-nuxt-pdf-${version}.tgz`
    writeFileSync(join(releaseDir, 'release-artifact.json'), JSON.stringify({
      commit: sourceSha,
      tarball: filename,
    }))
    writeFileSync(join(releaseDir, 'registry-verification.json'), JSON.stringify({ sourceSha }))
    writeFileSync(join(releaseDir, 'release-notes.md'), 'Release notes\n')
    writeFileSync(join(releaseDir, filename), tarballBytes)
    writeChecksums(releaseDir, [
      'release-artifact.json',
      'registry-verification.json',
      'release-notes.md',
      filename,
    ])

    const ghFixture = join(directory, 'gh-fixture.json')
    const ghLog = join(directory, 'gh.log')
    writeFileSync(ghFixture, JSON.stringify({
      tag,
      peeled,
      postConflict,
      postForbidden,
      releaseExists,
      releaseStatus,
    }))
    writeFileSync(ghLog, '')
    const fakeGh = join(binDir, 'gh')
    writeFileSync(fakeGh, fakeGhSource)
    chmodSync(fakeGh, 0o755)
    const fakeCurl = join(binDir, 'curl')
    writeFileSync(fakeCurl, fakeCurlSource)
    chmodSync(fakeCurl, 0o755)

    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', githubReleaseProgram], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        GH_FIXTURE: ghFixture,
        GH_LOG: ghLog,
        GH_TOKEN: 'fixture',
        GITHUB_API_URL: 'https://api.github.test',
        GITHUB_REPOSITORY: 'lupinum-dev/nuxt-pdf',
        GITHUB_SHA: currentMainSha,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
        RELEASE_VERSION: version,
      },
    })
    const calls = readFileSync(ghLog, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
    return { calls, result }
  }
  finally {
    rmSync(directory, { recursive: true })
  }
}

const stableRepair = runGithubRelease({
  version: '1.2.3',
  tag: { type: 'commit', sha: sourceSha },
  releaseExists: true,
})
assert.equal(stableRepair.result.status, 0, stableRepair.result.stderr)
const stableEdit = stableRepair.calls.find(args => args[0] === 'release' && args[1] === 'edit')
assert(stableEdit?.includes('--prerelease=false'), 'Stable repair must clear prerelease state.')

const annotatedTagSha = 'b'.repeat(40)
const prereleaseRepair = runGithubRelease({
  version: releaseVersion,
  tag: { type: 'tag', sha: annotatedTagSha },
  peeled: { [annotatedTagSha]: { type: 'commit', sha: sourceSha } },
  releaseExists: true,
})
assert.equal(prereleaseRepair.result.status, 0, prereleaseRepair.result.stderr)
assert(
  prereleaseRepair.calls.some(
    args => args[0] === 'api' && args[1].endsWith(`/git/tags/${annotatedTagSha}`),
  ),
  'Annotated tags must be peeled to their commit.',
)
const prereleaseEdit = prereleaseRepair.calls.find(args => args[0] === 'release' && args[1] === 'edit')
assert(prereleaseEdit?.includes('--prerelease'), 'Prerelease repair must set prerelease state.')

const conflictingTag = runGithubRelease({
  version: releaseVersion,
  tag: { type: 'commit', sha: currentMainSha },
  releaseExists: false,
})
assert.notEqual(conflictingTag.result.status, 0, 'A conflicting tag must stop release creation.')
assert(!conflictingTag.calls.some(args => args[0] === 'release' && ['create', 'edit', 'upload'].includes(args[1])))

const freshRelease = runGithubRelease({
  version: releaseVersion,
  tag: null,
  releaseExists: false,
})
assert.equal(freshRelease.result.status, 0, freshRelease.result.stderr)
const createCall = freshRelease.calls.find(args => args[0] === 'release' && args[1] === 'create')
assert(createCall, 'A missing tag and Release must use create.')
assert(createCall.includes('--verify-tag'))
assert(!createCall.includes('--target'))
assert.notEqual(sourceSha, currentMainSha)
assert(createCall.includes('--prerelease'))
const createTagCall = freshRelease.calls.find(
  args => args[0] === 'api' && args.includes('--method') && args.includes('POST'),
)
assert(createTagCall?.includes(`sha=${sourceSha}`), 'The missing tag must be created at source SHA.')

const racingTag = runGithubRelease({
  version: releaseVersion,
  tag: null,
  postConflict: { type: 'commit', sha: currentMainSha },
  releaseExists: false,
})
assert.notEqual(racingTag.result.status, 0, 'A tag appearing during creation must fail closed.')
assert(!racingTag.calls.some(args => args[0] === 'release' && args[1] === 'create'))

const orphanedRelease = runGithubRelease({
  version: releaseVersion,
  tag: null,
  releaseExists: true,
})
assert.notEqual(orphanedRelease.result.status, 0, 'Release repair requires its existing tag.')
assert(!orphanedRelease.calls.some(args => args[0] === 'release' && ['edit', 'upload'].includes(args[1])))

const historicalTagForbidden = runGithubRelease({
  version: releaseVersion,
  tag: null,
  postForbidden: true,
  releaseExists: false,
})
assert.notEqual(historicalTagForbidden.result.status, 0)
assert.match(historicalTagForbidden.result.stdout, /HUMAN-ONLY:/u)
assert.match(historicalTagForbidden.result.stdout, /refs\/tags\/v1\.2\.3-beta\.1/u)
assert.match(historicalTagForbidden.result.stdout, new RegExp(sourceSha, 'u'))
assert(!historicalTagForbidden.calls.some(
  args => args[0] === 'release' && ['create', 'edit', 'upload'].includes(args[1]),
))

const unknownReleaseState = runGithubRelease({
  version: releaseVersion,
  tag: null,
  releaseExists: false,
  releaseStatus: 500,
})
assert.notEqual(unknownReleaseState.result.status, 0, 'Unknown Release state must fail closed.')
assert(!unknownReleaseState.calls.some(
  args => args[0] === 'api' && args.includes('--method') && args.includes('POST'),
))

process.stdout.write('Protected release recovery fixtures passed.\n')
