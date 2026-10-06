import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'

// Gives a packed-package consumer app the repository's install policy (quarantine and build
// allowlist) without its workspace packages or its dependency overrides.
export async function prepareConsumerPolicy(directory, now = Date.now()) {
  const policy = parseDocument(await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8'))
  policy.set('packages', ['.'])
  policy.set('linkWorkspacePackages', false)
  // Consumers must resolve the published dependency graph without workspace patches.
  policy.delete('overrides')
  policy.delete('auditConfig')
  await writeFile(join(directory, 'pnpm-workspace.yaml'), policy.toString())
  // npm has no exact-version exception equivalent; give it the same cutoff.
  return `--before=${new Date(now - policy.get('minimumReleaseAge') * 60_000).toISOString()}`
}
