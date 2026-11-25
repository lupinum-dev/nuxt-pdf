import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetch as nuxtFetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { version } from '../package.json'
import NuxtPdf from '../src/module'
import { parsePdf } from '../src/test/pdf'

describe('Nuxt module metadata', () => {
  it('matches the Nuxt peer range published to users', async () => {
    await expect(NuxtPdf.getMeta!()).resolves.toMatchObject({
      compatibility: { nuxt: '>=4.4.8' },
    })
  })

  it('carries the published package identity', async () => {
    await expect(NuxtPdf.getMeta!()).resolves.toMatchObject({
      name: '@lupinum/nuxt-pdf',
      version,
      configKey: 'pdf',
      docs: 'https://nuxt-pdf.lupinum.com',
    })
  })
})

const template = (text: string, script = 'definePdf({ sampleData: {} })') => `<script setup lang="ts">
${script}
</script>

<template>
  <PdfDocument><PdfPage><PdfText>${text}</PdfText></PdfPage></PdfDocument>
</template>
`

// No definePdf: the compiler error points at the <script setup> block.
const brokenTemplate = template('Broken', 'const unused = 1')
// Mismatched tags: a syntax error inside a component.
const brokenComponent = `<template>\n  <PdfText>Part</PdfView>\n</template>\n`
// Compile, but fail later: an import nothing resolves, a definePdf value that
// fails validation, and a prop removed in this version.
const missingImport = template('{{ label() }}', 'import { label } from \'./helpers/lable\'\ndefinePdf({ sampleData: {} })')
const missingPackage = template('{{ label() }}', 'import { label } from \'not-installed-pdf-helper\'\ndefinePdf({ sampleData: {} })')
const invalidOption = template('Invalid', 'definePdf({ sampleData: {}, maxPasses: 0 })')
const removedProp = template('<PdfText :render="() => \'x\'" />')
// A local module in the import graph that fails: a syntax error, and a
// helper that imports a module that does not exist.
const badHelper = template('{{ x }}', 'import { x } from \'./helpers/bad\'\ndefinePdf({ sampleData: {} })')
// Compile, then fail while Vue renders: a throw in setup and a component
// nothing registers.
const throwsInSetup = template('x', 'definePdf({ sampleData: {} })\nthrow new Error(\'boom <img src=x onerror=alert(1)>\')')
const unresolvedComponent = template('<Missing />')
const helperChain = template('{{ label() }}', 'import { label } from \'./helpers/chain\'\ndefinePdf({ sampleData: {} })')

// Each request records a step. A failing test prints them, so a hang names
// the request instead of ending in a bare test timeout.
const steps: string[] = []
let testStart = 0
const step = (text: string) => steps.push(`+${((Date.now() - testStart) / 1000).toFixed(1)}s ${text}`)
beforeEach(({ onTestFailed }) => {
  steps.length = 0
  testStart = Date.now()
  onTestFailed(() => console.error(`Steps of the failed test:\n${steps.join('\n')}`))
})

// A dev request answers in well under a second, or in a few seconds while
// Nitro rebuilds. One that takes longer than this hangs.
const REQUEST_TIMEOUT_MS = 20_000

/** A dev-server request that fails after `REQUEST_TIMEOUT_MS` with its path. */
const request = async (path: string): Promise<Response> => {
  const started = Date.now()
  try {
    const response = await nuxtFetch(path, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    step(`GET ${path} -> ${response.status} (${Date.now() - started} ms)`)
    return response
  }
  catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    step(`GET ${path} -> ${timedOut ? 'no answer' : String(error)} (${Date.now() - started} ms)`)
    throw timedOut ? new Error(`GET ${path} did not answer within ${REQUEST_TIMEOUT_MS} ms`, { cause: error }) : error
  }
}

/** Retry until the check passes; the dev server rebuilds in the background. */
const eventually = async (check: () => Promise<void>, timeoutMs = 60_000): Promise<void> => {
  const end = Date.now() + timeoutMs
  for (;;) {
    try {
      return await check()
    }
    catch (error) {
      if (Date.now() > end) throw error
      await new Promise(done => setTimeout(done, 500))
    }
  }
}

const setupId = async (): Promise<string> => ((await (await request('/api/setup-id')).json()) as { id: string }).id

const page = async (path: string) => {
  const response = await request(path)
  return { status: response.status, html: await response.text() }
}

const pdfText = async (path: string): Promise<string> => {
  const parsed = await parsePdf(new Uint8Array(await (await request(path)).arrayBuffer()))
  return parsed.pages[0]?.text ?? ''
}

describe('Nuxt module in development', async () => {
  // A throwaway app inside the repository, so it resolves `nuxt` and `vue`
  // from the root node_modules. The tests add, edit and remove its files.
  await mkdir('.tmp', { recursive: true })
  const rootDir = await mkdtemp(resolve('.tmp/dev-app-'))
  const modulePath = fileURLToPath(new URL('../src/module', import.meta.url))
  const files: Record<string, string> = {
    'package.json': '{ "private": true, "type": "module" }\n',
    // The inline module takes a new id each time Nuxt runs module setup, so
    // `/api/setup-id` changes on a Nuxt restart but not on a Nitro rebuild.
    'nuxt.config.ts': `import { randomUUID } from 'node:crypto'
import NuxtPdf from ${JSON.stringify(modulePath)}

export default defineNuxtConfig({
  modules: [NuxtPdf, (_options, nuxt) => {
    const id = randomUUID()
    nuxt.options.nitro.virtual = { ...nuxt.options.nitro.virtual, '#setup-id': () => \`export default \${JSON.stringify(id)}\` }
  }],
  vite: { server: { hmr: false, ws: false } },
})
`,
    'server/api/setup-id.get.ts': `import id from '#setup-id'\n\nexport default defineEventHandler(() => ({ id }))\n`,
    'app.vue': '<template><div>dev app</div></template>\n',
    'pdfs/ok.vue': template('Still works'),
    'pdfs/broken.vue': brokenTemplate,
    'pdfs/components/BadPart.vue': brokenComponent,
    'pdfs/uses-part.vue': template('<BadPart />', 'import BadPart from \'./components/BadPart.vue\'\ndefinePdf({ sampleData: {} })'),
    'pdfs/missing-import.vue': missingImport,
    'pdfs/missing-package.vue': missingPackage,
    'pdfs/invalid-option.vue': invalidOption,
    'pdfs/removed-prop.vue': removedProp,
    'pdfs/helpers/label.ts': 'export const label = () => \'Label\'\n',
    'pdfs/throws-setup.vue': throwsInSetup,
    'pdfs/unresolved.vue': unresolvedComponent,
    'pdfs/bad-helper.vue': badHelper,
    'pdfs/helpers/bad.ts': 'export const x = (\n',
    'pdfs/helper-chain.vue': helperChain,
    'pdfs/helpers/chain.ts': 'export { label } from \'./nope\'\n',
    'pdfs/theme.css': '.title { font-size: 31pt }\n',
    'pdfs/themed.vue': `<script setup lang="ts">\ndefinePdf({ sampleData: {} })\n</script>\n\n<template>\n  <PdfDocument><PdfPage><PdfText class="title">Themed</PdfText></PdfPage></PdfDocument>\n</template>\n\n<style>\n@import '~/pdfs/theme.css';\n</style>\n`,
    'server/api/broken.get.ts': `import { NuxtPdfError, pdf } from '#pdf'\n\nexport default defineEventHandler(async () => {\n  try {\n    await pdf.broken.render({})\n    return { code: 'none' }\n  }\n  catch (error) {\n    return error instanceof NuxtPdfError ? { code: error.code, source: error.source } : { code: 'unknown' }\n  }\n})\n`,
  }
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(rootDir, path)), { recursive: true })
    await writeFile(join(rootDir, path), contents)
  }
  // Registered before `setup`, so it runs after the server has stopped.
  afterAll(() => rm(rootDir, { recursive: true, force: true }))

  // With `dev: true`, test-utils builds a second Nuxt in this process besides
  // the `nuxi _dev` server. Both rebuild Nitro on a file change; with one
  // build directory the slower one overwrote `.nuxt/dev/index.mjs`, and the
  // server then answered with this process's `#setup-id`, as if it had
  // restarted. A build directory of its own keeps that copy apart.
  await setup({ dev: true, rootDir, nuxtConfig: { buildDir: join(rootDir, '.nuxt-test-process') } })

  it('keeps the server up when a template or component fails to compile, and shows where', async () => {
    const index = await page('/_pdf')
    expect(index.status).toBe(200)
    expect(index.html).toContain('href="/_pdf/ok"')
    expect(index.html).toMatch(/<strong>broken<\/strong>.*?<span class="meta failed">Compile error<\/span>/s)

    expect((await page('/_pdf/ok')).html).toMatch(/src="\/_pdf\/ok\.pdf\?render=/)

    const broken = await page('/_pdf/broken')
    expect(broken.status).toBe(200)
    expect(broken.html).toContain('This template failed to compile')
    expect(broken.html).toContain('PDF_TEMPLATE_INVALID')
    // The message is the compiler's, without the absolute path it logs.
    expect(broken.html).toContain('<p class="message">A PDF template must contain exactly one top-level definePdf({...}) call.</p>')
    expect(broken.html).toMatch(/<button type="button" class="source"[^>]*>pdfs\/broken\.vue:1:25<\/button>/)

    const usesPart = await page('/_pdf/uses-part')
    expect(usesPart.html).toContain('This template failed to compile')
    expect(usesPart.html).toMatch(/class="source"[^>]*>pdfs\/components\/BadPart\.vue:2:\d+<\/button>/)

    // Listed as failed once its render met the failed component.
    expect((await page('/_pdf')).html).toMatch(/<strong>uses-part<\/strong>.*?<span class="meta failed">Compile error<\/span>/s)

    // A throw in setup says so, without the thrown text; Vue's message for
    // an unresolved component is the author's source and is shown.
    const throws = await page('/_pdf/throws-setup')
    expect(throws.html).toContain('The template threw while rendering. Check the server output for details.')
    expect(throws.html).not.toContain('boom')
    expect((await page('/_pdf/unresolved')).html).toContain('Failed to resolve component: Missing')

    const api = await request('/api/broken')
    expect(await api.json()).toMatchObject({ code: 'PDF_TEMPLATE_INVALID', source: { file: 'pdfs/broken.vue' } })

    // Each fails alone, at the import, the definePdf call or the prop.
    const failures = [
      ['missing-import', 'pdfs/missing-import.vue:2:23', 'Cannot resolve the import &quot;./helpers/lable&quot;.'],
      ['missing-package', 'pdfs/missing-package.vue:2:23', 'Cannot resolve the import &quot;not-installed-pdf-helper&quot;.'],
      ['invalid-option', 'pdfs/invalid-option.vue:2:1', 'maxPasses must be a positive integer.'],
      ['removed-prop', 'pdfs/removed-prop.vue:6:43', 'render'],
      ['bad-helper', 'pdfs/helpers/bad.ts:2:1', 'Unexpected end of file'],
      ['helper-chain', 'pdfs/helpers/chain.ts:', 'nope'],
    ] as const
    for (const [key, position, message] of failures) {
      expect(index.html).toMatch(new RegExp(`<strong>${key}</strong>.*?<span class="meta failed">Compile error</span>`, 's'))
      const failed = await page(`/_pdf/${key}`)
      expect(failed.html, key).toContain('This template failed to compile')
      expect(failed.html, key).toContain(message)
      // A position that ends in ":" leaves the line and column open.
      const exact = position.replaceAll('.', '\\.') + (position.endsWith(':') ? '\\d+:\\d+' : '')
      expect(failed.html, key).toMatch(new RegExp(`class="source"[^>]*>${exact}</button>`))
    }
  }, 60_000)

  it('resolves a Nuxt alias in a style @import', async () => {
    const raw = await request('/_pdf/themed.pdf')
    expect(raw.status).toBe(200)
    const parsed = await parsePdf(new Uint8Array(await raw.arrayBuffer()))
    expect(parsed.pages[0]?.textRuns.find(run => run.text === 'Themed')?.fontSize).toBe(31)
  }, 60_000)

  it('recovers when the failing template is fixed, without a restart', async () => {
    const before = await setupId()
    step('fix broken.vue, missing-import.vue, invalid-option.vue and helpers/bad.ts')
    await writeFile(join(rootDir, 'pdfs/broken.vue'), template('Fixed now'))
    await writeFile(join(rootDir, 'pdfs/missing-import.vue'), missingImport.replace('./helpers/lable', './helpers/label'))
    await writeFile(join(rootDir, 'pdfs/invalid-option.vue'), template('Valid now'))
    await writeFile(join(rootDir, 'pdfs/helpers/bad.ts'), 'export const x = \'Helper fixed\'\n')
    await eventually(async () => {
      for (const key of ['broken', 'missing-import', 'invalid-option', 'bad-helper']) {
        expect((await page(`/_pdf/${key}`)).html, key).toMatch(new RegExp(`src="/_pdf/${key}\\.pdf\\?render=`))
      }
    })
    expect(await pdfText('/_pdf/broken.pdf')).toContain('Fixed now')
    expect(await pdfText('/_pdf/missing-import.pdf')).toContain('Label')
    expect(await pdfText('/_pdf/invalid-option.pdf')).toContain('Valid now')
    expect(await pdfText('/_pdf/bad-helper.pdf')).toContain('Helper fixed')
    expect(await setupId()).toBe(before)
  }, 90_000)

  it('registers an added template and drops a removed one, without a restart', async () => {
    const before = await setupId()
    await writeFile(join(rootDir, 'pdfs/added.vue'), template('Added later'))
    await eventually(async () => {
      expect((await page('/_pdf/added')).status).toBe(200)
    })
    expect(await pdfText('/_pdf/added.pdf')).toContain('Added later')

    await rm(join(rootDir, 'pdfs/added.vue'))
    await eventually(async () => {
      expect((await page('/_pdf/added')).status).toBe(404)
    })
    expect((await page('/_pdf/ok')).status).toBe(200)
    expect(await setupId()).toBe(before)
  }, 120_000)
})
