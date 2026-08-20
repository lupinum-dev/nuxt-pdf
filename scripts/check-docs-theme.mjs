import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const docsDir = resolve(rootDir, 'docs')
const failures = []

const [appConfig, nuxtConfig, themeCss, packageSource] = await Promise.all([
  readFile(resolve(docsDir, 'app/app.config.ts'), 'utf8'),
  readFile(resolve(docsDir, 'nuxt.config.ts'), 'utf8'),
  readFile(resolve(docsDir, 'app/assets/css/theme.css'), 'utf8'),
  readFile(resolve(docsDir, 'package.json'), 'utf8'),
])
const docsPackage = JSON.parse(packageSource)

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message)
}

for (const [name, pattern] of [
  ['theme.neutral', /neutral:\s*['"]custom['"]/],
  ['theme.primary', /primary:\s*['"]custom['"]/],
  ['theme.codeBlocks', /codeBlocks:\s*['"]adaptive['"]/],
]) {
  requireMatch(appConfig, pattern, `app.config.ts must set ${name} to the Nuxt theme value.`)
}

requireMatch(
  nuxtConfig,
  /css:\s*\[[^\]]*theme\.css/,
  'nuxt.config.ts must register the consumer-owned theme.css.',
)
requireMatch(
  nuxtConfig,
  /light:\s*['"]material-theme-lighter['"]/,
  'nuxt.config.ts must use Material Theme Lighter for light syntax.',
)
requireMatch(
  nuxtConfig,
  /dark:\s*['"]material-theme-palenight['"]/,
  'nuxt.config.ts must use Material Theme Palenight for dark syntax.',
)

if (docsPackage.dependencies?.['@lupinum/ginko-docs'] !== '0.3.0') {
  failures.push('docs/package.json must use @lupinum/ginko-docs 0.3.0.')
}
if (packageSource.includes('pkg.pr.new')) {
  failures.push('docs/package.json must not use an ephemeral pkg.pr.new dependency.')
}

const nuxtGreens = {
  50: '#effdf5',
  100: '#d9fbe8',
  200: '#b3f5d1',
  300: '#75edae',
  400: '#00dc82',
  500: '#00c16a',
  600: '#00a155',
  700: '#007f45',
  800: '#016538',
  900: '#0a5331',
  950: '#052e16',
}

for (const [shade, value] of Object.entries(nuxtGreens)) {
  requireMatch(
    themeCss,
    new RegExp(`--nuxt-green-${shade}:\\s*${value}`, 'i'),
    `theme.css must define Nuxt green ${shade} as ${value}.`,
  )
  requireMatch(
    themeCss,
    new RegExp(`--theme-neutral-${shade}:\\s*var\\(--color-slate-${shade}\\)`),
    `theme.css must map Slate neutral ${shade}.`,
  )
}

for (const token of [
  '--theme-primary-light:',
  '--theme-primary-light-foreground:',
  '--theme-primary-light-ring:',
  '--theme-primary-dark:',
  '--theme-primary-dark-foreground:',
  '--theme-primary-dark-ring:',
  '--background:',
  '--foreground:',
  '--primary:',
  '--ring:',
  '--code:',
  '--hero-bg:',
  '--agent-background:',
  '--ui-bg:',
  '--ui-text:',
  '--ui-primary:',
]) {
  requireMatch(themeCss, new RegExp(token), `theme.css must define ${token.slice(0, -1)}.`)
}

requireMatch(
  themeCss,
  /\.dark\s*\{[\s\S]*--background:\s*var\(--color-slate-950\)/,
  'theme.css must use Slate 950 for the dark page background.',
)
requireMatch(
  themeCss,
  /\.dark\s*\{[\s\S]*--muted:\s*var\(--color-slate-900\)/,
  'theme.css must use Slate 900 for dark muted surfaces.',
)
requireMatch(
  themeCss,
  /\.dark\s*\{[\s\S]*--accent:\s*var\(--color-slate-800\)/,
  'theme.css must use Slate 800 for dark accented surfaces.',
)

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
}
else {
  console.log('Documentation Nuxt theme contract verified.')
}
