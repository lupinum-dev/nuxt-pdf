import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const docsDir = resolve(rootDir, 'docs')
const failures = []

const [appConfig, nuxtConfig, packageSource] = await Promise.all([
  readFile(resolve(docsDir, 'app/app.config.ts'), 'utf8'),
  readFile(resolve(docsDir, 'nuxt.config.ts'), 'utf8'),
  readFile(resolve(docsDir, 'package.json'), 'utf8'),
])
const docsPackage = JSON.parse(packageSource)

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message)
}

requireMatch(
  appConfig,
  /preset:\s*['"]nuxt['"]/,
  'app.config.ts must select the shared Nuxt theme preset.',
)
requireMatch(
  appConfig,
  /codeBlocks:\s*['"]adaptive['"]/,
  'app.config.ts must use adaptive code blocks.',
)

if (/\b(?:neutral|primary):\s*['"]custom['"]/.test(appConfig)) {
  failures.push('app.config.ts must not re-declare shared Nuxt palettes.')
}
if (/theme\.css/.test(nuxtConfig)) {
  failures.push('nuxt.config.ts must not register a copied shared theme.')
}

const copiedThemeExists = await access(resolve(docsDir, 'app/assets/css/theme.css')).then(
  () => true,
  (error) => {
    if (error?.code === 'ENOENT') return false
    throw error
  },
)
if (copiedThemeExists) {
  failures.push('Delete the copied theme.css; Ginko Docs owns the Nuxt preset.')
}

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

if (docsPackage.dependencies?.['@lupinum/ginko-docs'] !== '0.4.0-rc.5') {
  failures.push('docs/package.json must use @lupinum/ginko-docs 0.4.0-rc.5.')
}
if (docsPackage.dependencies?.['@lupinum/ginko-content'] !== '1.0.0-beta.5') {
  failures.push('docs/package.json must use @lupinum/ginko-content 1.0.0-beta.5.')
}
if (packageSource.includes('pkg.pr.new')) {
  failures.push('docs/package.json must not use an ephemeral pkg.pr.new dependency.')
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
}
else {
  console.log('Documentation Nuxt theme preset contract verified.')
}
