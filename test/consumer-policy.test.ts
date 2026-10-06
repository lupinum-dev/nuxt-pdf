import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { expect, it } from 'vitest'
import { prepareConsumerPolicy } from '../scripts/consumer-policy.mjs'

it('keeps the quarantine for packed consumers and gives npm the same cutoff', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nuxt-pdf-consumer-policy-'))
  try {
    const now = Date.now()
    expect(await prepareConsumerPolicy(directory, now))
      .toBe(`--before=${new Date(now - 24 * 60 * 60 * 1000).toISOString()}`)
    const policy = parseDocument(await readFile(join(directory, 'pnpm-workspace.yaml'), 'utf8'))
    expect(policy.get('minimumReleaseAge')).toBe(1440)
    expect(policy.get('minimumReleaseAgeStrict')).toBe(true)
    expect(policy.get('overrides')).toBeUndefined()
    expect(policy.get('linkWorkspacePackages')).toBe(false)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})
