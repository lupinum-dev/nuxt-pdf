import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const docsDir = resolve(rootDir, 'docs')
const errors = []

function requireMatch(source, pattern, label) {
  if (!pattern.test(source)) errors.push(label)
}

const [appConfig, nuxtConfig, themeCss] = await Promise.all([
  readFile(resolve(docsDir, 'app/app.config.ts'), 'utf8'),
  readFile(resolve(docsDir, 'nuxt.config.ts'), 'utf8'),
  readFile(resolve(docsDir, 'app/assets/css/theme.css'), 'utf8'),
])

requireMatch(appConfig, /neutral:\s*"custom"/, 'app.config.ts must set theme.neutral to custom.')
requireMatch(appConfig, /primary:\s*"custom"/, 'app.config.ts must set theme.primary to custom.')
requireMatch(appConfig, /codeBlocks:\s*"adaptive"/, 'app.config.ts must set theme.codeBlocks to adaptive.')

requireMatch(nuxtConfig, /material-theme-lighter/, 'nuxt.config.ts must configure material-theme-lighter.')
requireMatch(nuxtConfig, /material-theme-palenight/, 'nuxt.config.ts must configure material-theme-palenight.')
requireMatch(
  nuxtConfig,
  /css:\s*\[[^\]]*~\/assets\/css\/theme\.css/,
  'nuxt.config.ts must register ~/assets/css/theme.css.',
)

for (const shade of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
  requireMatch(
    themeCss,
    new RegExp(`--theme-neutral-${shade}:`),
    `theme.css must define --theme-neutral-${shade}.`,
  )
}

for (const token of [
  '--theme-primary-light:',
  '--theme-primary-light-foreground:',
  '--theme-primary-light-ring:',
  '--theme-primary-dark:',
  '--theme-primary-dark-foreground:',
  '--theme-primary-dark-ring:',
]) {
  requireMatch(themeCss, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `theme.css must define ${token.slice(0, -1)}.`)
}

const canonicalGreens = {
  '--nuxt-green-400': '#00dc82',
  '--nuxt-green-500': '#00c16a',
  '--nuxt-green-700': '#007f45',
  '--nuxt-green-950': '#052e16',
}

for (const [name, value] of Object.entries(canonicalGreens)) {
  requireMatch(
    themeCss,
    new RegExp(`${name}:\\s*${value}`, 'i'),
    `theme.css must define ${name} as ${value}.`,
  )
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
}
else {
  console.log('Documentation Nuxt theme contract verified.')
}
