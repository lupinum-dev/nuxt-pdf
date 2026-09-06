import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { expect, it } from 'vitest'
import { prepareConsumerPolicy } from '../scripts/consumer-policy.mjs'

it('checks the generated install policy and gives npm the same quarantine cutoff', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nuxt-pdf-consumer-policy-'))
  const checker = fileURLToPath(new URL('../scripts/check-dependency-policy.mjs', import.meta.url))
  try {
    const now = Date.now()
    expect(await prepareConsumerPolicy(directory, now))
      .toBe(`--before=${new Date(now - 24 * 60 * 60 * 1000).toISOString()}`)
    const path = join(directory, 'pnpm-workspace.yaml')
    const policy = parseDocument(await readFile(path, 'utf8'))
    expect(policy.get('overrides')).toBeUndefined()
    expect(policy.get('linkWorkspacePackages')).toBe(false)
    expect(execFileSync(process.execPath, [checker, path], { encoding: 'utf8' }))
      .toContain('Dependency quarantine policy passed.')

    policy.set('minimumReleaseAgeStrict', false)
    await writeFile(path, policy.toString())
    const weakened = spawnSync(process.execPath, [checker, path], { encoding: 'utf8' })
    expect(weakened.status).toBe(1)
    expect(weakened.stderr).toContain('minimumReleaseAgeStrict must be true')

    policy.set('minimumReleaseAgeStrict', true)
    policy.delete('minimumReleaseAgeExclude')
    await writeFile(path, `${policy.toString()}\nminimumReleaseAgeExclude:\n  - '@lupinum/example@1.2.3' # {"reason":"Controlled expiry test","owner":"test","expires":"2020-01-01T00:00:00Z"}\n`)
    const expired = spawnSync(process.execPath, [checker, path], { encoding: 'utf8' })
    expect(expired.status).toBe(1)
    expect(expired.stderr).toContain('quarantine exception expired')
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})
