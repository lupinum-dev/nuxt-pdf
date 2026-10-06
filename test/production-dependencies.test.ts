import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

type Tree = Record<string, { dependencies?: Tree }>

// Users install these with the module if a dependency starts to pull them in. The module drives a
// Vue renderer; React's renderer runtime must never become a production dependency.
const forbidden = ['@react-pdf/reconciler', '@react-pdf/renderer', 'react', 'react-dom', 'react-reconciler']

it('installs no React renderer runtime with the published package', () => {
  const projects: { path: string, dependencies?: Tree }[] = JSON.parse(execFileSync(
    'pnpm',
    ['list', '--prod', '--depth', 'Infinity', '--json'],
    // The full production tree exceeds execFileSync's default 1 MB buffer.
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ))
  const root = projects.find(project => resolve(project.path) === resolve('.'))
  expect(root, 'pnpm did not report the root package').toBeDefined()
  const found = new Set<string>()
  const visit = (dependencies: Tree = {}) => {
    for (const [name, dependency] of Object.entries(dependencies)) {
      if (forbidden.includes(name)) found.add(name)
      visit(dependency.dependencies)
    }
  }
  visit(root?.dependencies)
  expect([...found]).toEqual([])
}, 60_000)
