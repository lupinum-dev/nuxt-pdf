import { execFileSync } from 'node:child_process'

export function releaseSource(rootDir, { retained = false, sha = process.env.RELEASE_SOURCE_SHA } = {}) {
  const git = args => execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' }).trim()
  const head = git(['rev-parse', 'HEAD'])
  if (!/^[a-f0-9]{40}$/u.test(head) || (sha !== undefined && sha !== head)) {
    throw new Error('The release artifact source must match the current HEAD commit.')
  }
  if (retained && git(['status', '--porcelain', '--untracked-files=normal'])) {
    throw new Error('Commit all source changes before retaining a release candidate.')
  }
  return head
}
