import { resolve } from 'node:path'
import { buildPackageAgentDocs, verifyPackageAgentDocs } from './package-agent-docs.mjs'

const root = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(root, 'docs/.output/public/raw')
await buildPackageAgentDocs({
  packageRoot: root,
  sourceRoot,
  startRoutes: [
    '/docs/getting-started/installation',
    '/docs/reference/module-options',
  ],
})
const manifest = await verifyPackageAgentDocs(root, { sourceRoot })
console.log(`Packaged ${manifest.pages.length} documentation pages for ${manifest.name}@${manifest.version}.`)
