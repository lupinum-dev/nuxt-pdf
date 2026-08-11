import { execFileSync, spawn } from 'node:child_process'
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

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

const writeFixture = async (appDir, tarball, manager) => {
  const packageSpec = `file:${relative(appDir, tarball).replaceAll('\\', '/')}`
  const versions = {
    '@napi-rs/canvas': await installedVersion('@napi-rs/canvas'),
    '@types/node': await installedVersion('@types/node'),
    'nuxt': await installedVersion('nuxt'),
    'pdfjs-dist': await installedVersion('pdfjs-dist'),
    'typescript': await installedVersion('typescript'),
    'vue': await installedVersion('vue'),
    'vue-tsc': await installedVersion('vue-tsc'),
  }

  await Promise.all([
    mkdir(join(appDir, 'pdfs', 'assets'), { recursive: true }),
    mkdir(join(appDir, 'pdfs', 'components'), { recursive: true }),
    mkdir(join(appDir, 'pdfs', 'fonts'), { recursive: true }),
    mkdir(join(appDir, 'pdfs'), { recursive: true }),
    mkdir(join(appDir, 'server', 'api'), { recursive: true }),
  ])

  await writeFile(join(appDir, 'package.json'), `${JSON.stringify({
    name: 'nuxt-pdf-package-smoke',
    private: true,
    type: 'module',
    packageManager: manager === 'npm'
      ? `npm@${process.env.npm_config_user_agent?.match(/npm\/([^ ]+)/)?.[1] ?? '11'}`
      : packageJson.packageManager,
    dependencies: {
      [packageJson.name]: packageSpec,
      nuxt: versions.nuxt,
      vue: versions.vue,
    },
    devDependencies: {
      '@napi-rs/canvas': versions['@napi-rs/canvas'],
      '@types/node': versions['@types/node'],
      'pdfjs-dist': versions['pdfjs-dist'],
      'typescript': versions.typescript,
      'vue-tsc': versions['vue-tsc'],
    },
  }, null, 2)}\n`)

  if (manager === 'pnpm') {
    await writeFile(join(appDir, 'pnpm-workspace.yaml'), `packages:
  - .

allowBuilds:
  '@parcel/watcher': true
  esbuild: true
  unrs-resolver: true
`)
  }

  await writeFile(join(appDir, 'nuxt.config.ts'), `export default defineNuxtConfig({
  compatibilityDate: '2026-07-20',
  modules: [${JSON.stringify(packageJson.name)}],
  pdf: {
    fonts: [
      { family: 'Source Code Pro', src: 'SourceCodePro-Regular.ttf', fontWeight: 400 },
      { family: 'Source Code Pro', src: 'SourceCodePro-Bold.ttf', fontWeight: 700 },
    ],
  },
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

  await writeFile(join(appDir, 'public-api-types.ts'), `import type {
  PdfFontDeclaration,
  PdfLimitsOptions,
  RemoteAssetOptions,
} from '${packageJson.name}'
import type {
  RenderPdfSfcOptions,
  RenderPdfTemplateOptions,
} from '${packageJson.name}/test'

const font: PdfFontDeclaration = {
  family: 'Source Code Pro',
  src: 'SourceCodePro-Regular.ttf',
  fontWeight: 400,
}
const limits: PdfLimitsOptions = { maxPages: 2 }
const remote: RemoteAssetOptions = {
  allow: ['https://assets.example.com/pdf/'],
}
const templateOptions: RenderPdfTemplateOptions = { limits, remote }
const sfcOptions: RenderPdfSfcOptions = { fonts: [font], limits, remote }

const removedTemplateAssets: RenderPdfTemplateOptions = {
  // @ts-expect-error Prepared asset maps are private registry inputs.
  assets: {},
}
const removedTemplateFile: RenderPdfTemplateOptions = {
  // @ts-expect-error Source attribution is inferred by the public helper.
  file: 'pdfs/invoice.vue',
}
const removedTemplateFonts: RenderPdfTemplateOptions = {
  // @ts-expect-error Embedded font descriptors are private build output.
  fonts: [],
}
const removedTemplateKey: RenderPdfTemplateOptions = {
  // @ts-expect-error Template attribution is inferred by the public helper.
  key: 'invoice',
}
const removedSfcRoot: RenderPdfSfcOptions = {
  // @ts-expect-error The application root is inferred from the SFC path.
  rootDir: '.',
}
const removedSfcKey: RenderPdfSfcOptions = {
  // @ts-expect-error The template key is inferred from the SFC path.
  key: 'invoice',
}

void [
  templateOptions,
  sfcOptions,
  removedTemplateAssets,
  removedTemplateFile,
  removedTemplateFonts,
  removedTemplateKey,
  removedSfcRoot,
  removedSfcKey,
]
`)

  await Promise.all([
    copyFile(
      join(rootDir, 'test', 'fixtures', 'assets', 'sample.png'),
      join(appDir, 'pdfs', 'assets', 'brand.png'),
    ),
    copyFile(
      join(rootDir, 'node_modules', 'source-code-pro', 'TTF', 'SourceCodePro-Regular.ttf'),
      join(appDir, 'pdfs', 'fonts', 'SourceCodePro-Regular.ttf'),
    ),
    copyFile(
      join(rootDir, 'node_modules', 'source-code-pro', 'TTF', 'SourceCodePro-Bold.ttf'),
      join(appDir, 'pdfs', 'fonts', 'SourceCodePro-Bold.ttf'),
    ),
  ])

  await writeFile(join(appDir, 'pdfs', 'components', 'InvoiceHeader.vue'), `<script setup lang="ts">
defineProps<{
  customer: string
  number: string
}>()
</script>

<template>
  <PdfView :style="{ alignItems: 'center', flexDirection: 'row', marginBottom: 24 }">
    <PdfImage
      src="brand.png"
      :style="{ height: 32, marginRight: 12, width: 32 }"
    />
    <PdfView>
      <PdfText :style="{ fontSize: 18, fontWeight: 700 }">
        Invoice {{ number }}
      </PdfText>
      <PdfText>Prepared for {{ customer }}</PdfText>
    </PdfView>
  </PdfView>
</template>
`)

  await writeFile(join(appDir, 'pdfs', 'invoice.vue'), `<script setup lang="ts">
import InvoiceHeader from './components/InvoiceHeader.vue'

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
const pageNumbers = usePdfPageNumbers()

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
      :style="{ fontFamily: 'Source Code Pro', padding: 48 }"
    >
      <InvoiceHeader
        :customer="props.invoice.customer"
        :number="props.invoice.number"
      />
      <PdfText :style="{ fontSize: 24, fontWeight: 700 }">
        Installable invoice {{ props.invoice.number }}
      </PdfText>
      <PdfText>Total: {{ props.invoice.total }}</PdfText>
      <PdfText id="target">Target page {{ pageNumbers.target ?? '' }}</PdfText>
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

  await writeFile(join(appDir, 'test-pdf-sfc.mjs'), `import { fileURLToPath } from 'node:url'
import {
  expectPdf,
  rasterizePdf,
  renderPdfSfc,
} from '${packageJson.name}/test'

const props = {
  invoice: {
    customer: 'Ada Lovelace',
    number: 'QS-001',
    total: 'EUR 1,250.00',
  },
}
const rendered = await renderPdfSfc(
  fileURLToPath(new URL('./pdfs/invoice.vue', import.meta.url)),
  props,
  {
    fonts: [
      { family: 'Source Code Pro', src: 'SourceCodePro-Regular.ttf', fontWeight: 400 },
      { family: 'Source Code Pro', src: 'SourceCodePro-Bold.ttf', fontWeight: 700 },
    ],
  },
)

expectPdf(rendered.parsed)
  .toHavePageCount(1)
  .toContainText('Invoice QS-001')
  .toContainText('Prepared for Ada Lovelace')
  .toContainText('Target page 1')
  .toContainText('Page 1 of 1')

if (rendered.result.diagnostics.passes < 2) {
  throw new Error('Packed-SFC composable did not activate multi-pass rendering.')
}
const title = rendered.parsed.pages[0].textRuns.find(run => run.text.includes('Installable'))
if (!title || title.fontSize !== 24 || title.x < 40 || title.y < 700) {
  throw new Error('Unexpected packed-SFC title geometry: ' + JSON.stringify(title))
}
const [page] = await rasterizePdf(rendered.bytes)
if (!page || page.width < 590 || page.height < 840 || page.png.byteLength === 0) {
  throw new Error('Packed-SFC raster evidence is missing or malformed.')
}
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
    const text = content.items
      .flatMap(item => 'str' in item ? [item.str] : [])
      .join(' ')
      .replace(/\s+/g, ' ')

    assert(text.includes('Installable invoice QS-001'), `PDF is missing the typed invoice data. Extracted: ${JSON.stringify(text)}`)
    assert(text.includes('Prepared for Ada Lovelace'), 'PDF is missing the customer data.')
    assert(text.includes('Total: EUR 1,250.00'), 'PDF is missing the nested total.')
    assert(text.includes('Target page 1'), 'PDF is missing the resolved destination page.')
    assert(text.includes('Page 1 of 1'), 'PDF is missing dynamic page text.')
  }
  finally {
    await document.destroy()
  }
}

const availablePort = () => new Promise((resolvePort, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    server.close(error => error ? reject(error) : resolvePort(port))
  })
})

const executeBuiltRoute = async (appDir) => {
  const port = await availablePort()
  const output = []
  const server = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: appDir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', chunk => output.push(String(chunk)))
  server.stderr.on('data', chunk => output.push(String(chunk)))

  try {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (server.exitCode !== null) {
        throw new Error(`Built Nuxt server exited early:\n${output.join('')}`)
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/invoice`)
        if (response.status !== 503) {
          return {
            bytes: Buffer.from(await response.arrayBuffer()),
            headers: response.headers,
            status: response.status,
          }
        }
      }
      catch {
        // Server is still starting.
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
    }
    throw new Error(`Timed out waiting for the built Nuxt server:\n${output.join('')}`)
  }
  finally {
    if (server.exitCode === null) {
      await new Promise((resolveExit) => {
        server.once('exit', resolveExit)
        server.kill('SIGTERM')
      })
    }
  }
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

try {
  let tarball
  if (process.env.NUXT_PDF_TARBALL) {
    const sourceTarball = resolve(process.env.NUXT_PDF_TARBALL)
    tarball = join(temporaryDirectory, basename(sourceTarball))
    await copyFile(sourceTarball, tarball)
  }
  else {
    const output = execFileSync(
      'npm',
      ['pack', '--json', '--pack-destination', temporaryDirectory],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          npm_config_cache: join(temporaryDirectory, 'pack-cache'),
          npm_config_loglevel: 'silent',
        },
        maxBuffer: 10 * 1024 * 1024,
      },
    )
    const report = parsePackReport(output)
    tarball = join(temporaryDirectory, basename(report.filename))

    assert(report.name === packageJson.name, `Quickstart packed the wrong package: ${report.name}.`)
    assert(report.version === packageJson.version, `Quickstart packed the wrong version: ${report.version}.`)
  }

  const managers = process.env.NUXT_PDF_PACKAGE_MANAGERS?.split(',') ?? ['npm', 'pnpm']
  for (const manager of managers) {
    assert(manager === 'npm' || manager === 'pnpm', `Unsupported package manager: ${manager}.`)
    const appDir = join(temporaryDirectory, manager)
    await mkdir(appDir)
    await writeFixture(appDir, tarball, manager)

    if (manager === 'npm') {
      run('npm', ['install', '--cache', join(temporaryDirectory, 'npm-cache'), '--no-audit', '--no-fund'], appDir)
      run('npm', ['exec', '--', 'nuxt', 'prepare'], appDir)
      run('npm', ['exec', '--', 'vue-tsc', '--noEmit'], appDir)
      run(process.execPath, ['test-pdf-sfc.mjs'], appDir)
      run('npm', ['exec', '--', 'nuxt', 'build'], appDir)
    }
    else {
      const store = join(temporaryDirectory, 'pnpm-store')
      run('pnpm', ['install', '--store-dir', store], appDir)
      run('pnpm', ['exec', 'nuxt', 'prepare'], appDir)
      run('pnpm', ['exec', 'vue-tsc', '--noEmit'], appDir)
      run(process.execPath, ['test-pdf-sfc.mjs'], appDir)
      run('pnpm', ['exec', 'nuxt', 'build'], appDir)
    }

    const { bytes, headers, status } = await executeBuiltRoute(appDir)
    assert(status === 200, `${manager} production PDF route returned ${status}.`)
    assert(headers.get('content-type') === 'application/pdf', `${manager} production route has the wrong content type.`)
    assert(headers.get('content-length') === String(bytes.byteLength), `${manager} production route has the wrong content length.`)
    assert(
      headers.get('content-disposition')?.startsWith('attachment; filename="invoice-QS-001.pdf"'),
      `${manager} production route has the wrong content disposition.`,
    )
    await assertPdfSemantics(bytes)
    await assertProductionBoundary(appDir)

    console.log(`Verified ${packageJson.name}@${packageJson.version} with ${manager} in a fresh Nuxt production application.`)
  }
}
finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}
