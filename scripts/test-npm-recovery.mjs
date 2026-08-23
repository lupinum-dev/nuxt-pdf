import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAIN_REF,
  PROVENANCE_TYPE,
  REGISTRY_URL,
  REPOSITORY_URL,
  WORKFLOW_PATH,
  createRegistryVerificationRecord,
  fetchAttestations,
  integritySha512,
  resolveReleaseSource,
  sigstorePolicy,
  validateProvenanceStatement,
} from './verify-npm-recovery.mjs'

const manifest = {
  packageName: '@lupinum/nuxt-pdf',
  packageVersion: '1.2.3-beta.1',
  commit: 'a'.repeat(40),
  tarball: 'lupinum-nuxt-pdf-1.2.3-beta.1.tgz',
}
const currentMainSha = 'c'.repeat(40)
const tarballBytes = Buffer.from('certified nuxt pdf tarball')
const sha1 = createHash('sha1').update(tarballBytes).digest('hex')
const sha512 = createHash('sha512').update(tarballBytes).digest('hex')
const integrity = `sha512-${Buffer.from(sha512, 'hex').toString('base64')}`

const statement = () => ({
  _type: 'https://in-toto.io/Statement/v1',
  subject: [{
    name: 'pkg:npm/%40lupinum/nuxt-pdf@1.2.3-beta.1',
    digest: { sha512 },
  }],
  predicateType: PROVENANCE_TYPE,
  predicate: {
    buildDefinition: {
      externalParameters: {
        workflow: {
          ref: MAIN_REF,
          repository: REPOSITORY_URL,
          path: WORKFLOW_PATH,
        },
      },
      resolvedDependencies: [{
        uri: `git+${REPOSITORY_URL}@${MAIN_REF}`,
        digest: { gitCommit: manifest.commit },
      }],
    },
    runDetails: {
      builder: { id: 'https://github.com/actions/runner/github-hosted' },
    },
  },
})

const bundle = (value = statement()) => ({
  mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
  dsseEnvelope: {
    payloadType: 'application/vnd.in-toto+json',
    payload: Buffer.from(JSON.stringify(value)).toString('base64'),
    signatures: [{ sig: 'fixture' }],
  },
  verificationMaterial: {},
})

const attestationDocument = value => ({
  attestations: [{ predicateType: PROVENANCE_TYPE, bundle: bundle(value) }],
})

validateProvenanceStatement(statement(), manifest, sha512)
assert.equal(integritySha512(integrity), sha512)

const mutations = [
  ['predicate type', value => (value.predicateType = 'wrong')],
  ['subject', value => (value.subject[0].name = 'pkg:npm/wrong@1.2.3-beta.1')],
  ['tarball sha512', value => (value.subject[0].digest.sha512 = '0'.repeat(128))],
  ['extra subject', value => value.subject.push(structuredClone(value.subject[0]))],
  ['workflow repository', value => (value.predicate.buildDefinition.externalParameters.workflow.repository = 'https://github.com/example/wrong')],
  ['workflow path', value => (value.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/wrong.yml')],
  ['workflow ref', value => (value.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/wrong')],
  ['source sha', value => (value.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'b'.repeat(40))],
  ['builder', value => (value.predicate.runDetails.builder.id = 'https://github.com/example/runner')],
]

for (const [name, mutate] of mutations) {
  const value = statement()
  mutate(value)
  assert.throws(
    () => validateProvenanceStatement(value, manifest, sha512),
    /does not match the certified workflow, source, and tarball/u,
    `${name} must be rejected`,
  )
}

const policy = sigstorePolicy(manifest.commit)
assert.equal(policy.certificateIssuer, 'https://token.actions.githubusercontent.com')
assert.equal(
  policy.certificateIdentityURI,
  '^https://github\\.com/lupinum-dev/nuxt-pdf/\\.github/workflows/release\\.yml@refs/heads/main$',
)
assert.deepEqual(policy.certificateOIDs, {
  '1.3.6.1.4.1.57264.1.3': manifest.commit,
  '1.3.6.1.4.1.57264.1.5': 'lupinum-dev/nuxt-pdf',
  '1.3.6.1.4.1.57264.1.6': MAIN_REF,
})

let verifyArguments
const existingRecord = await createRegistryVerificationRecord({
  manifest,
  tarballBytes,
  registryShasum: sha1,
  attestationDocument: attestationDocument(statement()),
  verifyBundle: async (...args) => {
    verifyArguments = args
  },
})
assert.equal(verifyArguments.length, 2)
assert.deepEqual(verifyArguments[1], policy)
assert.equal(existingRecord.registryState, 'verified-existing')
assert.equal(existingRecord.registryShasum, sha1)
assert.match(existingRecord.provenanceBundleSha256, /^[0-9a-f]{64}$/u)
assert.equal(existingRecord.tarballSha512, sha512)

const absentRecord = await createRegistryVerificationRecord({
  manifest,
  tarballBytes,
  registryShasum: null,
  attestationDocument: null,
  verifyBundle: () => assert.fail('Absent versions must not invoke Sigstore.'),
})
assert.equal(absentRecord.registryState, 'absent')
assert.equal(absentRecord.registryShasum, null)
assert.equal(absentRecord.provenanceBundleSha256, null)

const registryViews = new Map([
  [`${manifest.packageName}@${manifest.packageVersion} version`, manifest.packageVersion],
  [`${manifest.packageName}@${manifest.packageVersion} dist.shasum`, sha1],
  [`${manifest.packageName}@${manifest.packageVersion} dist.integrity`, integrity],
  [`${manifest.packageName}@${manifest.packageVersion} dist.attestations`, { url: `${REGISTRY_URL}/-/npm/v1/attestations/fixture` }],
])
let sourcePolicy
const existingSource = await resolveReleaseSource({
  packageVersion: manifest.packageVersion,
  currentMainSha,
  view: (spec, field) => registryViews.get(`${spec} ${field}`),
  fetchDocument: async () => attestationDocument(statement()),
  verifyBundle: async (_bundle, suppliedPolicy) => {
    sourcePolicy = suppliedPolicy
  },
})
assert.deepEqual(existingSource, {
  registryState: 'verified-existing',
  sourceSha: manifest.commit,
})
assert.equal(sourcePolicy.certificateOIDs['1.3.6.1.4.1.57264.1.3'], manifest.commit)
assert.notEqual(existingSource.sourceSha, currentMainSha, 'Recovery must keep the provenance source.')

const absentSource = await resolveReleaseSource({
  packageVersion: '1.2.4',
  currentMainSha,
  view: () => null,
  fetchDocument: () => assert.fail('Absent versions have no provenance document.'),
  verifyBundle: () => assert.fail('Absent versions have no Sigstore bundle.'),
})
assert.deepEqual(absentSource, { registryState: 'absent', sourceSha: currentMainSha })

const sigstorePrefix = (version) => {
  const prefix = mkdtempSync(join(tmpdir(), 'nuxt-pdf-sigstore-'))
  const packageDir = join(prefix, 'node_modules', 'sigstore')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: 'sigstore', version, main: 'index.cjs' }),
  )
  writeFileSync(join(packageDir, 'index.cjs'), 'exports.verify = async () => {};\n')
  return prefix
}

const previousPrefix = process.env.SIGSTORE_PREFIX
const exactPrefix = sigstorePrefix('5.0.0')
const wrongPrefix = sigstorePrefix('4.1.1')
try {
  process.env.SIGSTORE_PREFIX = exactPrefix
  const isolatedRecord = await createRegistryVerificationRecord({
    manifest,
    tarballBytes,
    registryShasum: sha1,
    attestationDocument: attestationDocument(statement()),
  })
  assert.equal(isolatedRecord.registryState, 'verified-existing')

  process.env.SIGSTORE_PREFIX = wrongPrefix
  await assert.rejects(
    createRegistryVerificationRecord({
      manifest,
      tarballBytes,
      registryShasum: sha1,
      attestationDocument: attestationDocument(statement()),
    }),
    /Expected sigstore 5\.0\.0, received 4\.1\.1/u,
  )
}
finally {
  if (previousPrefix === undefined) delete process.env.SIGSTORE_PREFIX
  else process.env.SIGSTORE_PREFIX = previousPrefix
  rmSync(exactPrefix, { recursive: true })
  rmSync(wrongPrefix, { recursive: true })
}

await assert.rejects(
  createRegistryVerificationRecord({
    manifest,
    tarballBytes,
    registryShasum: '0'.repeat(40),
    attestationDocument: null,
  }),
  /exists with different bytes/u,
)

await assert.rejects(
  createRegistryVerificationRecord({
    manifest,
    tarballBytes,
    registryShasum: sha1,
    attestationDocument: { attestations: [] },
  }),
  /has no unique npm provenance/u,
)

assert.throws(() => integritySha512('sha256-wrong'), /no exact SHA-512 integrity/u)

const attestationUrl = `${REGISTRY_URL}/-/npm/v1/attestations/fixture`
let requestOptions
await fetchAttestations({ url: attestationUrl }, async (url, options) => {
  assert.equal(url.href, attestationUrl)
  requestOptions = options
  return { ok: true, json: async () => ({ attestations: [] }) }
})
assert.equal(requestOptions.redirect, 'error')
assert(requestOptions.signal instanceof AbortSignal)
assert.equal(requestOptions.headers.Accept, 'application/json')

for (const invalidUrl of [
  'https://user@registry.npmjs.org/-/npm/v1/attestations/fixture',
  'https://registry.npmjs.org:444/-/npm/v1/attestations/fixture',
  'https://registry.npmjs.org/-/npm/v1/attestations/fixture?token=secret',
  'https://registry.npmjs.org/-/npm/v1/attestations/fixture#fragment',
  'https://registry.npmjs.org/package.json',
]) {
  await assert.rejects(
    fetchAttestations(
      { url: invalidUrl },
      () => assert.fail('Invalid URLs must fail before fetch.'),
    ),
    /outside the registry attestation API/u,
  )
}

process.stdout.write('npm recovery verification fixtures passed.\n')
