import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import { loadPdfDocumentationContracts } from './docs-contracts.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const contentRoot = join(repositoryRoot, 'docs/content')
const failures = []

const markdownFiles = await findMarkdownFiles(contentRoot)
const documentation = new Map(await Promise.all(markdownFiles.map(async file => [
  relative(repositoryRoot, file),
  await readFile(file, 'utf8'),
])))
const allDocumentation = [...documentation.values()].join('\n')
const contracts = await loadPdfDocumentationContracts(repositoryRoot)

checkErrorCodes()
checkPageSizes()
checkRenderLimits()
await checkPublicExports()

if (failures.length > 0) {
  console.error(`Documentation contract validation failed:\n\n${failures.join('\n')}`)
  process.exitCode = 1
}
else {
  console.log('Documentation contracts match public errors, page sizes, limits, and exports.')
}

function checkErrorCodes() {
  const file = 'docs/content/docs/2.guides/5.errors-and-debugging.md'
  const content = requiredContent(file)
  for (const code of Object.values(contracts.PDF_ERROR_CODES)) {
    if (!content.includes(`\`${code}\``)) failures.push(`${file}: missing error code ${code}.`)
  }
}

function checkPageSizes() {
  const file = 'docs/content/docs/3.reference/8.page-sizes.md'
  const content = requiredContent(file)
  for (const size of contracts.PDF_PAGE_SIZE_NAMES) {
    if (!content.includes(`\`${size}\``)) failures.push(`${file}: missing page size ${size}.`)
  }
}

function checkRenderLimits() {
  const file = 'docs/content/docs/3.reference/3.module-options.md'
  const content = requiredContent(file)
  const rows = content.split('\n')

  for (const [key, value] of Object.entries(contracts.DEFAULT_PDF_RENDER_LIMITS)) {
    const matchingRows = rows.filter(line => line.startsWith(`| \`${key}\` |`))
    if (matchingRows.length === 0) {
      failures.push(`${file}: missing pdf.limits.${key}.`)
      continue
    }

    const documentedDefault = `\`${formatNumber(value)}\``
    if (!matchingRows.some(row => row.includes(documentedDefault))) {
      failures.push(`${file}: pdf.limits.${key} must document the default ${documentedDefault}.`)
    }
  }
}

async function checkPublicExports() {
  const file = 'API_REPORT.md'
  const report = await readFile(join(repositoryRoot, file), 'utf8')
  const exports = extractPublicExports(report)

  for (const name of exports) {
    if (!allDocumentation.includes(`\`${name}\``)) {
      failures.push(`${file}: public export ${name} is missing from the documentation reference.`)
    }
  }
}

function extractPublicExports(report) {
  const code = [...report.matchAll(/```ts\n([\s\S]*?)```/gu)]
    .map(match => match[1])
    .join('\n')
  const names = new Set()

  for (const match of code.matchAll(/export (?:type )?\{([^}]+)\}/gu)) {
    for (const rawPart of match[1].split(',')) {
      const part = rawPart.trim().replace(/^type\s+/u, '')
      const name = part.split(/\s+as\s+/u).at(-1)
      if (name && name !== 'default' && /^[A-Za-z_$][\w$]*$/u.test(name)) names.add(name)
    }
  }

  return [...names].sort()
}

function formatNumber(value) {
  return String(value).replace(/\B(?=(?:\d{3})+(?!\d))/gu, '_')
}

function requiredContent(file) {
  const content = documentation.get(file)
  if (content === undefined) {
    failures.push(`${file}: required canonical documentation page is missing.`)
    return ''
  }
  return content
}

async function findMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await findMarkdownFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path)
  }

  return files.sort()
}
