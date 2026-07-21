import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const reportPath = join(rootDir, 'API_REPORT.md')
const declarations = [
  ['Package root', 'dist/types.d.mts'],
  ['Nuxt module', 'dist/module.d.mts'],
  ['Test entry', 'dist/test.d.mts'],
]

const sections = await Promise.all(declarations.map(async ([label, path]) => {
  const source = (await readFile(join(rootDir, path), 'utf8')).trim()
  return `## ${label}\n\nSource: \`${path}\`\n\n\`\`\`ts\n${source}\n\`\`\``
}))

const expected = `# Public API declaration report

This file is derived from the built declarations and is intentionally checked
in. Rebuild with \`pnpm build && pnpm api:write\`; CI verifies it with
\`pnpm test:api\`. Package code and generated \`#pdf\` registries remain the
canonical sources.

${sections.join('\n\n')}
`

if (process.argv.includes('--write')) {
  await writeFile(reportPath, expected)
  console.log('Updated API_REPORT.md from built declarations.')
}
else {
  const actual = await readFile(reportPath, 'utf8').catch(() => '')
  if (actual !== expected) {
    throw new Error('API_REPORT.md is stale. Run pnpm build && pnpm api:write.')
  }
  console.log('Public API declaration report matches the built package.')
}
