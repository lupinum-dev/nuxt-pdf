import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const requiredFiles = [
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'MAINTAINING.md',
  'README.md',
  'SECURITY.md',
  'docs/WRITING.md',
]
const excludedFiles = new Set([
  'API_REPORT.md',
  'CHANGELOG.md',
  'THIRD_PARTY_NOTICES.md',
  'docs/WRITING.md',
])
const forbiddenPatterns = [
  { pattern: /[—–…→←]/u, reason: 'Use short sentences and standard ASCII punctuation.' },
  { pattern: /\b(?:simply|just|obviously|easy|easily|seamless|seamlessly|powerful)\b/iu, reason: 'Remove subjective filler.' },
  { pattern: /\b(?:colour|colours|behaviour|summarises)\b/iu, reason: 'Use American English.' },
  { pattern: /Mat4m0/u, reason: 'Use the lupinum-dev organization.' },
]
const genericHeading = /^## (?:Summary|Conclusion|Next steps|Related)$/imu

const trackedFiles = execFileSync('git', ['ls-files'], {
  cwd: rootDir,
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean)
const trackedSet = new Set(trackedFiles)
const errors = []

for (const file of requiredFiles) {
  if (!trackedSet.has(file)) errors.push(`${file}: required documentation file is missing.`)
}

for (const file of trackedFiles.filter(file => file.endsWith('.md') && !excludedFiles.has(file))) {
  const content = await readFile(resolve(rootDir, file), 'utf8')
  for (const { pattern, reason } of forbiddenPatterns) {
    const match = content.match(pattern)
    if (!match || match.index === undefined) continue
    const line = content.slice(0, match.index).split('\n').length
    errors.push(`${file}:${line}: ${reason}`)
  }

  const heading = content.match(genericHeading)
  if (heading?.index !== undefined) {
    const line = content.slice(0, heading.index).split('\n').length
    errors.push(`${file}:${line}: Use a specific task heading.`)
  }

  if (file.startsWith('docs/content/')) {
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/u)
    if (!frontmatter) {
      errors.push(`${file}: documentation page needs YAML frontmatter.`)
      continue
    }
    if (!/^title: .+$/mu.test(frontmatter[1]) || !/^description: .+$/mu.test(frontmatter[1])) {
      errors.push(`${file}: frontmatter needs a title and description.`)
    }
    if (/^# /mu.test(content.slice(frontmatter[0].length))) {
      errors.push(`${file}: the page title comes from frontmatter; remove body-level H1 headings.`)
    }
  }
}

const readRequired = file => readFile(resolve(rootDir, file), 'utf8')
const [readme, security, maintaining] = await Promise.all([
  readRequired('README.md'),
  readRequired('SECURITY.md'),
  readRequired('MAINTAINING.md'),
])

for (const [file, content] of [['README.md', readme], ['SECURITY.md', security], ['MAINTAINING.md', maintaining]]) {
  if (!content.includes('Lupinum OG')) errors.push(`${file}: must identify Lupinum OG.`)
}
if (!readme.includes('https://discord.gg/RPH6SeA36N')) errors.push('README.md: shared Discord link is missing.')
if (!readme.includes('https://nuxt-pdf.lupinum.com')) errors.push('README.md: canonical documentation URL is missing.')

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
}
else {
  console.log(`Verified ${trackedFiles.filter(file => file.endsWith('.md')).length} tracked Markdown files.`)
}
