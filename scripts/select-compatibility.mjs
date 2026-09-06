import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkDependencyPolicyFile } from './check-dependency-policy.mjs'
import { consumerVersions } from './consumer-versions.mjs'

const mode = process.argv[2]
if (!['minimum', 'latest'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/select-compatibility.mjs minimum|latest')
}
const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const policy = await checkDependencyPolicyFile(join(root, 'pnpm-workspace.yaml'))
if (policy.length) throw new Error(policy.join('\n'))
const installed = async () => Object.fromEntries(await Promise.all(
  Object.keys(manifest.peerDependencies).map(async name => [
    name, JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8')).version,
  ]),
))
const versions = mode === 'latest'
  ? Object.fromEntries(Object.entries(manifest.peerDependencies).map(([name, range]) => [
      name, JSON.parse(execFileSync('pnpm', ['view', `${name}@${range}`, 'version', '--json'], { cwd: root, encoding: 'utf8' })),
    ]))
  : consumerVersions(manifest.peerDependencies, await installed())[0].versions
consumerVersions(manifest.peerDependencies, versions)
// Exact requests avoid pnpm preferring an older installed version. A newly
// published selection must still pass the unchanged install quarantine.
execFileSync('pnpm', ['add', '--workspace-root', '-D', ...Object.entries(versions).map(([name, version]) => `${name}@${version}`)], {
  cwd: root,
  stdio: 'inherit',
})
const actual = await installed()
consumerVersions(manifest.peerDependencies, actual)
if (Object.entries(versions).some(([name, version]) => actual[name] !== version)) {
  throw new Error('The compatibility install did not resolve the requested versions.')
}
console.log(`Installed ${mode} compatibility dependencies: ${JSON.stringify(actual)}`)
