import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { checkDependencyPolicyFile } from './check-dependency-policy.mjs'

export async function prepareConsumerPolicy(directory, now = Date.now()) {
  const source = new URL('../pnpm-workspace.yaml', import.meta.url)
  const rootFailures = await checkDependencyPolicyFile(source, now)
  if (rootFailures.length) throw new Error(rootFailures.join('\n'))
  const policy = parseDocument(await readFile(source, 'utf8'))
  policy.set('packages', ['.'])
  policy.set('linkWorkspacePackages', false)
  // Consumers must resolve the published dependency graph without workspace patches.
  policy.delete('overrides')
  const path = join(directory, 'pnpm-workspace.yaml')
  await writeFile(path, policy.toString())
  const failures = await checkDependencyPolicyFile(path, now)
  if (failures.length) throw new Error(failures.join('\n'))
  // npm has no exact-version exception equivalent; keep its cutoff stricter.
  return `--before=${new Date(now - policy.get('minimumReleaseAge') * 60_000).toISOString()}`
}
