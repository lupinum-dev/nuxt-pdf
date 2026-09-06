import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { releaseSource } from '../scripts/release-source.mjs'

it('binds retained evidence to a clean current commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nuxt-pdf-release-source-'))
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  try {
    git(['init', '--quiet'])
    await writeFile(join(root, 'package.json'), '{}\n')
    git(['add', 'package.json'])
    git(['-c', 'user.name=Release test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'test: create source'])
    const sha = git(['rev-parse', 'HEAD'])
    expect(releaseSource(root, { retained: true, sha })).toBe(sha)
    expect(() => releaseSource(root, { retained: true, sha: '0'.repeat(40) }))
      .toThrow('must match the current HEAD')
    expect(() => releaseSource(root, { sha: 'invalid' })).toThrow('must match the current HEAD')

    await writeFile(join(root, 'uncommitted.txt'), 'Uncommitted source\n')
    expect(() => releaseSource(root, { retained: true, sha })).toThrow('Commit all source changes')
    expect(releaseSource(root, { sha })).toBe(sha)
    await rm(join(root, 'uncommitted.txt'))
    await writeFile(join(root, 'package.json'), '{"changed":true}\n')
    expect(() => releaseSource(root, { retained: true, sha })).toThrow('Commit all source changes')
    git(['add', 'package.json'])
    git(['-c', 'user.name=Release test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'test: change source'])
    expect(() => releaseSource(root, { retained: true, sha })).toThrow('must match the current HEAD')
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
