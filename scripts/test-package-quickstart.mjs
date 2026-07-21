import { execFileSync } from 'node:child_process'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageJson = JSON.parse(
  await readFile(join(rootDir, 'package.json'), 'utf8'),
)

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const parsePackReport = (output) => {
  for (let index = output.lastIndexOf('['); index >= 0; index = output.lastIndexOf('[', index - 1)) {
    try {
      const report = JSON.parse(output.slice(index))
      if (Array.isArray(report) && report.length === 1) return report[0]
    }
    catch {
      // Lifecycle output can precede npm's JSON report.
    }
  }

  throw new Error(`npm pack did not return a usable JSON report:\n${output}`)
}

const run = (command, arguments_, cwd) => {
  execFileSync(command, arguments_, {
    cwd,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  })
}

const installedVersion = async (name) => {
  const dependency = JSON.parse(
    await readFile(join(rootDir, 'node_modules', name, 'package.json'), 'utf8'),
  )
  return dependency.version
}

const installedDependencyOverrides = () => {
  const projects = JSON.parse(execFileSync(
    'pnpm',
    ['list', '--depth', 'Infinity', '--json'],
    { cwd: rootDir, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
  ))
  const overrides = new Map()

  // Compare the trailing semver of an override value (`1.2.3` or
  // `npm:alias@1.2.3`) numerically; a higher tuple wins.
  const versionOf = value => value.slice(value.lastIndexOf('@') + 1)
  const isHigher = (candidate, existing) => {
    const left = versionOf(candidate).split('.').map(Number)
    const right = versionOf(existing).split('.').map(Number)
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const a = left[index] ?? 0
      const b = right[index] ?? 0
      if (a !== b) return a > b
    }
    return false
  }

  const addOverride = (selector, name, dependency) => {
    const version = dependency.version
    if (!version || version.startsWith('link:')) return
    const value = dependency.from && dependency.from !== name
      ? `npm:${dependency.from}@${version}`
      : version

    // A pnpm workspace can resolve the same `parent@version>child` edge to
    // several versions across peer-variant instances (the docs workspace pulls
    // a different Nuxt/unimport stack than the module). Every candidate is
    // already in the offline store, so any pins install offline; pick the
    // highest deterministically rather than failing the gate.
    const existing = overrides.get(selector)
    if (existing === undefined || isHigher(value, existing)) {
      overrides.set(selector, value)
    }
  }

  const visit = (parentName, parentVersion, dependencies = {}) => {
    for (const [name, dependency] of Object.entries(dependencies)) {
      addOverride(`${parentName}@${parentVersion}>${name}`, name, dependency)
      visit(
        dependency.from ?? name,
        dependency.version,
        dependency.dependencies,
      )
    }
  }

  for (const project of projects) {
    for (const [name, dependency] of Object.entries(project.dependencies ?? {})) {
      addOverride(name, name, dependency)
      visit(dependency.from ?? name, dependency.version, dependency.dependencies)
    }
    for (const [name, dependency] of Object.entries(project.devDependencies ?? {})) {
      addOverride(name, name, dependency)
      visit(dependency.from ?? name, dependency.version, dependency.dependencies)
    }
  }

  return [...overrides].sort(([left], [right]) => left.localeCompare(right))
}

const writeFixture = async (appDir, tarball) => {
  const packageSpec = `file:${relative(appDir, tarball).replaceAll('\\', '/')}`
  const dependencyOverrides = installedDependencyOverrides()
  const versions = {
    '@types/node': await installedVersion('@types/node'),
    'nuxt': await installedVersion('nuxt'),
    'typescript': await installedVersion('typescript'),
    'vue': await installedVersion('vue'),
    'vue-tsc': await installedVersion('vue-tsc'),
  }

  await Promise.all([
    mkdir(join(appDir, 'pdfs'), { recursive: true }),
    mkdir(join(appDir, 'server', 'api'), { recursive: true }),
  ])

  await writeFile(join(appDir, 'package.json'), `${JSON.stringify({
    name: 'nuxt-pdf-package-smoke',
    private: true,
    type: 'module',
    packageManager: packageJson.packageManager,
    dependencies: {
      [packageJson.name]: packageSpec,
      nuxt: versions.nuxt,
      vue: versions.vue,
    },
    devDependencies: {
      '@types/node': versions['@types/node'],
      'typescript': versions.typescript,
      'vue-tsc': versions['vue-tsc'],
    },
  }, null, 2)}\n`)

  await writeFile(join(appDir, 'pnpm-workspace.yaml'), `packages:
  - .

allowBuilds:
  '@parcel/watcher': true
  esbuild: true
  unrs-resolver: true

overrides:
${dependencyOverrides.map(([name, version]) => `  ${JSON.stringify(name)}: ${JSON.stringify(version)}`).join('\n')}
`)

  await writeFile(join(appDir, 'nuxt.config.ts'), `export default defineNuxtConfig({
  compatibilityDate: '2026-07-20',
  modules: [${JSON.stringify(packageJson.name)}],
})
`)

  await writeFile(join(appDir, 'tsconfig.json'), `{
  "extends": "./.nuxt/tsconfig.json"
}
`)

  await writeFile(join(appDir, 'app.vue'), `<template>
  <main>Package smoke application</main>
</template>
`)

  await writeFile(join(appDir, 'pdfs', 'invoice.vue'), `<script setup lang="ts">
// Mirrors the documented quickstart shape exactly: nested props, so the gate
// proves the same registry typegen and prop inference the docs teach.
type InvoiceProps = {
  invoice: {
    customer: string
    number: string
    total: string
  }
}

const props = defineProps<InvoiceProps>()

definePdf<InvoiceProps>({
  title: ({ invoice }) => \`Invoice \${invoice.number}\`,
  filename: ({ invoice }) => \`invoice-\${invoice.number}.pdf\`,
  language: 'en-GB',
  sampleData: {
    invoice: {
      customer: 'Ada Lovelace',
      number: 'QS-001',
      total: 'EUR 1,250.00',
    },
  },
})
</script>

<template>
  <PdfDocument>
    <PdfPage
      size="A4"
      :style="{ padding: 48 }"
    >
      <PdfText :style="{ fontSize: 24 }">
        Installable invoice {{ props.invoice.number }}
      </PdfText>
      <PdfText>Prepared for {{ props.invoice.customer }}</PdfText>
      <PdfText>Total: {{ props.invoice.total }}</PdfText>
      <PdfText
        fixed
        :style="{ bottom: 24, position: 'absolute', right: 48 }"
        :render="({ pageNumber, totalPages }) => \`Page \${pageNumber} of \${totalPages}\`"
      />
    </PdfPage>
  </PdfDocument>
</template>
`)

  await writeFile(join(appDir, 'server', 'api', 'invoice.get.ts'), `import { pdf } from '#pdf'

export default defineEventHandler(async () => {
  const props: Parameters<typeof pdf.invoice.render>[0] = {
    invoice: {
      customer: 'Ada Lovelace',
      number: 'QS-001',
      total: 'EUR 1,250.00',
    },
  }

  if (false) {
    // @ts-expect-error The generated registry rejects missing required props.
    await pdf.invoice.render({ invoice: { number: 'INVALID' } })
  }

  return (await pdf.invoice.render(props)).response()
})
`)
}

const assertPdfSemantics = async (bytes) => {
  assert(bytes.subarray(0, 5).toString() === '%PDF-', 'Production route did not return PDF bytes.')

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    verbosity: 0,
  })
  const document = await loadingTask.promise

  try {
    assert(document.numPages === 1, `Expected one PDF page; received ${document.numPages}.`)
    const page = await document.getPage(1)
    const content = await page.getTextContent()
    const text = content.items.flatMap(item => 'str' in item ? [item.str] : []).join(' ')

    assert(text.includes('Installable invoice QS-001'), 'PDF is missing the typed invoice data.')
    assert(text.includes('Prepared for Ada Lovelace'), 'PDF is missing the customer data.')
    assert(text.includes('Total: EUR 1,250.00'), 'PDF is missing the nested total.')
    assert(text.includes('Page 1 of 1'), 'PDF is missing dynamic page text.')
  }
  finally {
    await document.destroy()
  }
}

const executeBuiltRoute = async (appDir) => {
  const routeDirectory = join(
    appDir,
    '.output/server/chunks/routes/api',
  )
  const routePath = join(routeDirectory, 'invoice.get.mjs')
  const isolatedRoutePath = join(routeDirectory, 'invoice.get.isolated.mjs')
  const routeSource = await readFile(routePath, 'utf8')
  const nitroImport = 'import { d as defineEventHandler } from \'../../nitro/nitro.mjs\';\n'

  assert(
    routeSource.startsWith(nitroImport),
    'The production route no longer has the expected Nitro handler boundary.',
  )

  // The Node preset's shared Nitro chunk starts a listener on import. Replace
  // only that wrapper in a temporary copy so this package gate needs no port;
  // the regular production fixture still covers the HTTP route boundary.
  await writeFile(
    isolatedRoutePath,
    routeSource.replace(
      nitroImport,
      'const defineEventHandler = handler => handler;\n',
    ),
  )

  const routeModule = await import(pathToFileURL(isolatedRoutePath).href)
  assert(
    typeof routeModule.default === 'function',
    'The production build did not export the invoice route handler.',
  )

  const response = await routeModule.default({})
  assert(response instanceof Response, 'The production route did not return a Response.')
  return response
}

const assertProductionBoundary = async (appDir) => {
  const serverDirectory = join(appDir, '.output/server')
  const serverFiles = await readdir(serverDirectory, { recursive: true })
  const serverSources = await Promise.all(
    serverFiles
      .filter(path => path.endsWith('.mjs'))
      .map(path => readFile(join(serverDirectory, path), 'utf8')),
  )
  const serverBundle = serverSources.join('\n')

  assert(
    !serverBundle.includes('No templates found. Add <code>pdfs/invoice.vue</code>')
    && !serverBundle.includes('Preview data required'),
    'Development preview code leaked into the production server build.',
  )

  const clientDirectory = join(appDir, '.output/public/_nuxt')
  const clientFiles = await readdir(clientDirectory, { recursive: true })
  const clientSources = await Promise.all(
    clientFiles
      .filter(path => path.endsWith('.js'))
      .map(path => readFile(join(clientDirectory, path), 'utf8')),
  )

  assert(
    !/@react-pdf|fontkit|pdfkit|yoga-layout|nuxt-pdf:sfc/.test(
      clientSources.join('\n'),
    ),
    'PDF engine code leaked into the production client bundle.',
  )
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'nuxt-pdf-quickstart-'))
const appDir = join(temporaryDirectory, 'app')

try {
  await mkdir(appDir)

  const output = execFileSync(
    'npm',
    ['pack', '--json', '--pack-destination', temporaryDirectory],
    {
      cwd: rootDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: join(temporaryDirectory, 'npm-cache'),
        npm_config_loglevel: 'silent',
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  const report = parsePackReport(output)
  const tarball = join(temporaryDirectory, basename(report.filename))

  assert(report.name === '@lupinum/nuxt-pdf', `Quickstart packed the wrong package: ${report.name}.`)
  assert(report.version === packageJson.version, `Quickstart packed the wrong version: ${report.version}.`)

  await writeFixture(appDir, tarball)

  const storePath = execFileSync(
    'pnpm',
    ['store', 'path', '--silent'],
    { cwd: rootDir, encoding: 'utf8' },
  ).trim()

  run('pnpm', ['install', '--offline', '--store-dir', storePath], appDir)
  run('pnpm', ['exec', 'nuxt', 'prepare'], appDir)
  run('pnpm', ['exec', 'vue-tsc', '--noEmit'], appDir)
  run('pnpm', ['exec', 'nuxt', 'build'], appDir)

  const response = await executeBuiltRoute(appDir)
  const bytes = Buffer.from(await response.arrayBuffer())

  assert(response.status === 200, `Production PDF route returned ${response.status}.`)
  assert(response.headers.get('content-type') === 'application/pdf', 'Production route has the wrong content type.')
  assert(
    response.headers.get('content-disposition')?.startsWith('attachment; filename="invoice-QS-001.pdf"'),
    'Production route has the wrong content disposition.',
  )
  await assertPdfSemantics(bytes)
  await assertProductionBoundary(appDir)

  console.log(`Verified ${packageJson.name}@${packageJson.version} in a fresh Nuxt production application.`)
}
finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}
