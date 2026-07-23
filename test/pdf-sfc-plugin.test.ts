import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  compilePdfSfc,
  createPdfSfcPlugin,
  PdfSfcCompileError,
} from '../src/build/pdf-sfc-plugin'
import { mountPdfComponent } from '../src/runtime/renderer/render-component'
import {
  PDF_PRIMITIVES,
  type PdfDynamicTextRender,
  type PdfElementNode,
} from '../src/runtime/renderer/types'

const fixturesDirectory = resolve('test/fixtures/pdf-sfc')
const invoiceFile = join(fixturesDirectory, 'InvoiceDocument.vue')
const lineItemFile = join(fixturesDirectory, 'LineItem.vue')
const invoiceDataFile = join(fixturesDirectory, 'invoice-data.ts')

let temporaryDirectory: string

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'nuxt-pdf-sfc-'))
})

afterAll(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true })
})

describe('PDF SFC compiler', () => {
  it('compiles a template to client VNodes and attaches extracted metadata', async () => {
    const source = await readFile(invoiceFile, 'utf8')
    const result = await compilePdfSfc(source, invoiceFile, 'template')

    expect(result.map).toMatchObject({
      sources: [invoiceFile],
    })
    expect(result.code).toContain('__nuxtPdf')
    expect(result.code).not.toMatch(/\bdefinePdf\s*\(/)
    expect(result.code).toContain('createVNode')
    expect(result.code).not.toContain('ssrRenderComponent')
    expect(result.code).not.toContain('ssrRenderSlot')
  })

  it('preserves executable metadata after erasing the macro', async () => {
    const filename = resolve('test/fixtures/pdf-sfc/runtime-metadata.vue')
    const source = `
<script setup lang="ts">
type Props = { id: string }
defineProps<Props>()
definePdf({
  title: 'Runtime metadata',
  filename: (props: Props) => \`invoice-\${props.id}.pdf\`,
  scenarios: { long: { id: 'long' } },
})
</script>
<template><PdfDocument /></template>
`
    const result = await compilePdfSfc(source, filename, 'template')
    const outputFile = join(temporaryDirectory, 'runtime-metadata.mjs')

    await mkdir(dirname(outputFile), { recursive: true })
    await writeFile(outputFile, result.code)

    const component = (await import(`${pathToFileURL(outputFile).href}?v=1`)).default

    expect(component.__nuxtPdf.title).toBe('Runtime metadata')
    expect(component.__nuxtPdf.filename({ id: '42' })).toBe('invoice-42.pdf')
    expect(component.__nuxtPdf.scenarios).toEqual({ long: { id: 'long' } })
  })

  it('allows imported metadata values but rejects setup-local bindings', async () => {
    const imported = `<script setup lang="ts">
import { sampleInvoice } from './invoice-data'
defineOptions({ name: 'ImportedMetadata' })
type Props = { id: string }
defineProps<Props>()
definePdf<Props>({ sampleData: sampleInvoice })
</script>
<template><PdfDocument /></template>`
    const local = `<script setup lang="ts">
defineOptions({ name: 'LocalMetadata' })
type Props = { id: string }
defineProps<Props>()
const preview = { id: 'must-not-ship' }
definePdf<Props>({ sampleData: preview })
</script>
<template><PdfDocument /></template>`

    await expect(compilePdfSfc(
      imported,
      resolve(fixturesDirectory, 'imported-metadata.vue'),
      'template',
    )).resolves.toMatchObject({
      code: expect.stringContaining('sampleData: sampleInvoice'),
    })
    await expect(compilePdfSfc(
      local,
      resolve(fixturesDirectory, 'local-metadata.vue'),
      'template',
    )).rejects.toThrow(
      'definePdf() metadata cannot reference locally declared <script setup> bindings',
    )
  })

  it('structurally removes preview-only metadata from production output', async () => {
    const filename = resolve('test/fixtures/pdf-sfc/production-metadata.vue')
    const source = `
<script setup lang="ts">
type Props = { id: string }
defineProps<Props>()
definePdf({
  title: 'Production metadata',
  filename: (props: Props) => \`invoice-\${props.id}.pdf\`,
  language: 'de-AT',
  maxPasses: 4,
  sampleData: { id: 'NUXT_PDF_SAMPLE_DATA_CANARY' },
  scenarios: { long: { id: 'NUXT_PDF_SCENARIO_CANARY' } },
})
</script>
<template><PdfDocument /></template>
`
    const development = await compilePdfSfc(
      source,
      filename,
      'template',
      false,
    )
    const production = await compilePdfSfc(
      source,
      filename,
      'template',
      true,
    )

    expect(development.code).toContain('NUXT_PDF_SAMPLE_DATA_CANARY')
    expect(development.code).toContain('NUXT_PDF_SCENARIO_CANARY')
    expect(production.code).not.toContain('NUXT_PDF_SAMPLE_DATA_CANARY')
    expect(production.code).not.toContain('NUXT_PDF_SCENARIO_CANARY')
    expect(production.code).not.toMatch(/\bsampleData\s*:/)
    expect(production.code).not.toMatch(/\bscenarios\s*:/)

    const outputFile = join(temporaryDirectory, 'production-metadata.mjs')
    await writeFile(outputFile, production.code)
    const component = (await import(`${pathToFileURL(outputFile).href}?v=1`)).default

    expect(Object.keys(component.__nuxtPdf)).toEqual([
      'title',
      'filename',
      'language',
      'maxPasses',
    ])
    expect(component.__nuxtPdf).toMatchObject({
      language: 'de-AT',
      maxPasses: 4,
      title: 'Production metadata',
    })
    expect(component.__nuxtPdf.filename({ id: '42' })).toBe('invoice-42.pdf')
  })

  it('preserves dynamic page text callbacks through SFC compilation', async () => {
    const filename = resolve('test/fixtures/pdf-sfc/dynamic-footer.vue')
    const source = `
<script setup lang="ts">
definePdf({})
</script>
<template>
  <PdfDocument>
    <PdfPage size="A4">
      <PdfText
        fixed
        :render="({ pageNumber, totalPages }) => \`Page \${pageNumber} of \${totalPages}\`"
        :style="{ bottom: 22, left: 42, position: 'absolute', right: 42, textAlign: 'center' }"
      />
    </PdfPage>
  </PdfDocument>
</template>
`
    const result = await compilePdfSfc(source, filename, 'template')
    const outputFile = join(temporaryDirectory, 'dynamic-footer.mjs')

    await writeFile(outputFile, result.code)
    const component = (await import(`${pathToFileURL(outputFile).href}?v=2`)).default
    const mounted = await mountPdfComponent(component)
    const page = mounted.document.children[0] as PdfElementNode
    const footer = page.children[0] as PdfElementNode

    expect(page.type).toBe(PDF_PRIMITIVES.Page)
    expect(footer.props.fixed).toBe(true)
    expect(footer.props.render).toBeTypeOf('function')
    expect((footer.props.render as PdfDynamicTextRender)({
      pageNumber: 1,
      totalPages: 2,
    })).toBe('Page 1 of 2')

    mounted.unmount()
  })

  it('injects the auto-imported composable only when used and not already imported', async () => {
    const composables = resolve('src/runtime/composables/index')
    const importLine = `import { usePdfPageNumbers } from ${JSON.stringify(composables)}`
    const usesFile = resolve('test/fixtures/pdf-sfc/uses-composable.vue')
    const importsFile = resolve('test/fixtures/pdf-sfc/imports-composable.vue')
    const plainFile = resolve('test/fixtures/pdf-sfc/plain.vue')

    const uses = `<script setup lang="ts">
definePdf({})
const pages = usePdfPageNumbers()
</script>
<template><PdfDocument><PdfPage><PdfText>{{ pages.a ?? '' }}</PdfText></PdfPage></PdfDocument></template>`
    const injected = await compilePdfSfc(uses, usesFile, 'template', false, composables)
    expect(injected.code).toContain(importLine)

    // Already imported by the author: no duplicate injection.
    const alreadyImported = `<script setup lang="ts">
import { usePdfPageNumbers } from ${JSON.stringify(composables)}
definePdf({})
const pages = usePdfPageNumbers()
</script>
<template><PdfDocument><PdfPage><PdfText>{{ pages.a ?? '' }}</PdfText></PdfPage></PdfDocument></template>`
    const notDoubled = await compilePdfSfc(alreadyImported, importsFile, 'template', false, composables)
    expect(notDoubled.code.match(/usePdfPageNumbers.*from/g)?.length).toBe(1)

    // Never referenced: nothing injected.
    const plain = `<script setup lang="ts">
definePdf({})
</script>
<template><PdfDocument><PdfPage><PdfText>Hi</PdfText></PdfPage></PdfDocument></template>`
    const untouched = await compilePdfSfc(plain, plainFile, 'template', false, composables)
    expect(untouched.code).not.toContain('usePdfPageNumbers')
  })

  it('compiles discovered components with typed props and slots but no metadata', async () => {
    const source = await readFile(lineItemFile, 'utf8')
    const result = await compilePdfSfc(source, lineItemFile, 'component')

    expect(result.code).toContain('props:')
    expect(result.code).toContain('label:')
    expect(result.code).toContain('renderSlot')
    expect(result.code).not.toContain('__nuxtPdf =')
    expect(result.code).not.toContain('ssrRenderSlot')
  })

  it('only transforms exact discovered files and ignores Vue subrequests', async () => {
    const files = new Map([
      [invoiceFile, 'template' as const],
      [lineItemFile, 'component' as const],
    ])
    const plugin = createPdfSfcPlugin({ files })
    const source = await readFile(invoiceFile, 'utf8')

    expect(await plugin.transform(source, resolve('other.vue'))).toBeNull()
    expect(await plugin.transform(source, `${invoiceFile}?vue&type=template`)).toBeNull()
    expect(await plugin.transform(source, invoiceFile)).toMatchObject({
      code: expect.stringContaining('__nuxtPdf'),
    })

    const invoiceId = plugin.resolveId(invoiceFile)
    expect(invoiceId).toMatch(/^\0nuxt-pdf:sfc:.*\.mjs$/)
    expect(await plugin.load(invoiceId!)).toMatchObject({
      code: expect.stringContaining('__nuxtPdf'),
    })
    expect(plugin.resolveId('./LineItem.vue', invoiceId!)).toMatch(
      /^\0nuxt-pdf:sfc:.*\.mjs$/,
    )
    expect(plugin.resolveId('./invoice-data', invoiceId!)).toBe(invoiceDataFile)
    expect(plugin.resolveId('./Unknown.vue', invoiceId!)).toBeNull()

    const basicInvoiceFile = resolve('test/fixtures/basic/pdfs/invoice.vue')
    const basicPlugin = createPdfSfcPlugin({
      files: new Map([[basicInvoiceFile, 'template' as const]]),
    })
    const basicInvoiceId = basicPlugin.resolveId(basicInvoiceFile)
    expect(basicPlugin.resolveId('./invoice.preview', basicInvoiceId!)).toBe(
      resolve('test/fixtures/basic/pdfs/invoice.preview.ts'),
    )
  })

  it.each([
    {
      label: 'missing macro',
      filename: 'missing.vue',
      source: '<template><PdfDocument /></template>',
      message: 'missing.vue:1:1 A PDF template must contain exactly one top-level definePdf({...}) call.',
    },
    {
      label: 'duplicate macro',
      filename: 'duplicate.vue',
      source: `<script setup>\ndefinePdf({ title: 'One' })\ndefinePdf({ title: 'Two' })\n</script>\n<template><PdfDocument /></template>`,
      message: 'duplicate.vue:3:1 A PDF template must contain exactly one definePdf() call; found 2.',
    },
    {
      label: 'non-object macro',
      filename: 'invalid.vue',
      source: `<script setup>\ndefinePdf(getMetadata())\n</script>\n<template><PdfDocument /></template>`,
      message: 'invalid.vue:2:1 definePdf() requires one static object argument.',
    },
    {
      label: 'nested macro',
      filename: 'nested.vue',
      source: `<script setup>\nconst metadata = definePdf({ title: 'Nested' })\n</script>\n<template><PdfDocument /></template>`,
      message: 'nested.vue:2:18 definePdf() must be a standalone top-level statement.',
    },
    {
      label: 'unknown key',
      filename: 'unknown.vue',
      source: `<script setup>\ndefinePdf({ typo: true })\n</script>\n<template><PdfDocument /></template>`,
      message: 'unknown.vue:2:13 Unsupported definePdf() metadata key "typo".',
    },
    {
      label: 'function in static field',
      filename: 'function-field.vue',
      source: `<script setup>\ndefinePdf({ language: () => 'en' })\n</script>\n<template><PdfDocument /></template>`,
      message: 'function-field.vue:2:13 definePdf() metadata key "language" cannot be a function. Functions are only supported for "title" and "filename".',
    },
  ])('rejects an invalid $label with a source location', async ({ filename, source, message }) => {
    const file = resolve(`test/fixtures/pdf-sfc/${filename}`)

    await expect(compilePdfSfc(source, file, 'template')).rejects.toThrow(message)
  })

  it('rejects definePdf in a component', async () => {
    const filename = resolve('test/fixtures/pdf-sfc/component-macro.vue')
    const source = `<script setup>\ndefinePdf({ title: 'No' })\n</script>\n<template><PdfView /></template>`

    await expect(compilePdfSfc(source, filename, 'component')).rejects.toThrow(
      'component-macro.vue:2:1 definePdf() is only allowed in discovered PDF templates.',
    )
  })

  it.each([
    {
      filename: 'styled.vue',
      source: `<script setup>\ndefinePdf({})\n</script>\n<template><PdfDocument /></template>\n<style>ignored</style>`,
      message: 'styled.vue:5:8 <style> blocks are not supported in PDF components.',
    },
    {
      filename: 'custom.vue',
      source: `<script setup>\ndefinePdf({})\n</script>\n<template><PdfDocument /></template>\n<docs>ignored</docs>`,
      message: 'custom.vue:5:7 <docs> custom blocks are not supported in PDF components.',
    },
  ])('rejects unsupported blocks with file and location', async ({ filename, source, message }) => {
    const file = resolve(`test/fixtures/pdf-sfc/${filename}`)

    await expect(compilePdfSfc(source, file, 'template')).rejects.toThrow(message)
  })

  it('exposes structured compiler errors', async () => {
    const filename = resolve('test/fixtures/pdf-sfc/missing.vue')

    try {
      await compilePdfSfc('<template />', filename, 'template')
      expect.unreachable('compilePdfSfc should reject a missing macro')
    }
    catch (error) {
      expect(error).toBeInstanceOf(PdfSfcCompileError)
      expect(error).toMatchObject({
        column: 1,
        filename,
        line: 1,
      })
    }
  })
})
