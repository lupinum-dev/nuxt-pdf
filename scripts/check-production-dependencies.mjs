import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workspacePolicy = readFileSync(resolve(rootDir, 'pnpm-workspace.yaml'), 'utf8')
const renovate = JSON.parse(readFileSync(resolve(rootDir, 'renovate.json'), 'utf8'))
for (const policy of [
  'minimumReleaseAge: 1440',
  'minimumReleaseAgeStrict: true',
  'minimumReleaseAgeIgnoreMissingTime: false',
]) {
  if (!workspacePolicy.includes(policy)) throw new Error(`pnpm-workspace.yaml is missing: ${policy}`)
}
if (renovate.minimumReleaseAge !== '1 day') {
  throw new Error('Renovate must match the 24-hour pnpm quarantine.')
}

const forbidden = new Set([
  '@react-pdf/reconciler',
  '@react-pdf/renderer',
  'react',
  'react-dom',
  'react-reconciler',
])

const projects = JSON.parse(execFileSync(
  'pnpm',
  ['list', '--prod', '--depth', 'Infinity', '--json'],
  // The full production tree JSON exceeds execFileSync's default 1MB buffer.
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
))

const found = new Set()

const visit = (dependencies = {}) => {
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (forbidden.has(name)) found.add(name)
    visit(dependency.dependencies)
  }
}

const packageProject = projects.find(project => resolve(project.path) === rootDir)
if (!packageProject) throw new Error('pnpm did not report the root package project.')

visit(packageProject.dependencies)

if (found.size > 0) {
  throw new Error(`Forbidden production dependencies: ${[...found].sort().join(', ')}`)
}

console.log('Production dependency graph contains no React renderer runtime.')
