import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  compilePdfSfc,
  createPdfSfcPlugin,
  PdfSfcCompileError,
} from '../src/build/pdf-sfc-plugin'
import { mountPdfComponent } from '../src/runtime/renderer/render-component'
import { PDF_PRIMITIVES } from '../src/runtime/primitives'
import type { PdfElementNode } from '../src/runtime/renderer/types'
import { renderPdfTemplate } from '../src/test'
import { loadCompiledPdfSfc } from '../src/test/render-sfc'

const fixturesDirectory = resolve('test/fixtures/pdf-sfc')
const invoiceFile = join(fixturesDirectory, 'InvoiceDocument.vue')
const lineItemFile = join(fixturesDirectory, 'LineItem.vue')
const invoiceDataFile = join(fixturesDirectory, 'invoice-data.ts')

const compilerPath = (path: string): string => path.replaceAll('\\', '/')

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
      sources: [compilerPath(invoiceFile)],
      sourcesContent: [source],
    })
    const markerOffset = result.code.indexOf('const props')
    const beforeMarker = result.code.slice(0, markerOffset)
    const generatedLine = beforeMarker.split('\n').length
    const generatedColumn = beforeMarker.length - beforeMarker.lastIndexOf('\n') - 1
    expect(originalPositionFor(new TraceMap(result.map!), {
      line: generatedLine,
      column: generatedColumn,
    })).toMatchObject({
      line: 11,
      source: compilerPath(invoiceFile),
    })
    expect(result.code).toContain('__nuxtPdf')
    expect(result.code).not.toMatch(/\bdefinePdf\s*\(/)
    expect(result.code).toContain('createVNode')
    expect(result.code).not.toContain('ssrRenderComponent')
    expect(result.code).not.toContain('ssrRenderSlot')
  })

  it('returns no map when separate script and template maps cannot be composed honestly', async () => {
    const source = `<script>export default { name: 'ClassicPdf' }</script>
<template><PdfDocument /></template>`
    const result = await compilePdfSfc(
      source,
      resolve(fixturesDirectory, 'classic.vue'),
      'component',
    )

    expect(result.map).toBeNull()
  })

  // The title reads a literal const: Vue hoists it to module scope, where the
  // metadata runs, so the hoist check must let it through.
  it('preserves executable metadata after erasing the macro', async () => {
    const filename = resolve('test/fixtures/pdf-sfc/runtime-metadata.vue')
    const source = `
<script setup lang="ts">
type Props = { id: string }
defineProps<Props>()
const title = 'Runtime metadata'
definePdf({
  title,
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
    // A computed key inside a value reads its binding.
    await expect(compilePdfSfc(
      local.replace('{ sampleData: preview }', '{ sampleData: { [preview]: 1 } }'),
      resolve(fixturesDirectory, 'local-metadata.vue'),
      'template',
    )).rejects.toThrow(
      'definePdf() metadata cannot reference locally declared <script setup> bindings',
    )
    // A shorthand property reads the binding of its name.
    await expect(compilePdfSfc(
      local.replace('const preview =', 'const sampleData =').replace('{ sampleData: preview }', '{ sampleData }'),
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

  it('compiles page tokens in a template into plain-data token nodes', async () => {
    const filename = resolve('test/fixtures/pdf-sfc/dynamic-footer.vue')
    const source = `
<script setup lang="ts">
definePdf({})
</script>
<template>
  <PdfDocument>
    <PdfPage size="A4">
      <PdfText fixed :style="{ bottom: 22, left: 42, position: 'absolute', right: 42 }">
        Page <PdfPageNumber /> of <PdfPageCount />
      </PdfText>
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
    expect(footer.children.map(child => child.type)).toEqual([
      PDF_PRIMITIVES.TextInstance,
      PDF_PRIMITIVES.PageNumber,
      PDF_PRIMITIVES.TextInstance,
      PDF_PRIMITIVES.PageCount,
    ])

    mounted.unmount()
  })

  it('injects scope-aware Vue imports', async () => {
    const uses = `<script setup lang="ts">
definePdf({})
const count = ref(1)
const doubled = computed(() => count.value * 2)
</script>
<template><PdfDocument><PdfPage><PdfText>{{ doubled }}</PdfText></PdfPage></PdfDocument></template>`
    const injected = await compilePdfSfc(uses, resolve('test/fixtures/pdf-sfc/uses-vue.vue'), 'template')
    expect(injected.code).toMatch(/import \{[^}]*\bref\b[^}]*\} from "vue"/)
    expect(injected.code).toMatch(/import \{[^}]*\bcomputed\b[^}]*\} from "vue"/)

    const shadowed = `<script setup lang="ts">
definePdf({})
const ref = (value: number) => value
const count = ref(1)
</script>
<template><PdfDocument><PdfPage><PdfText>{{ count }}</PdfText></PdfPage></PdfDocument></template>`
    const shadowedResult = await compilePdfSfc(
      shadowed,
      resolve('test/fixtures/pdf-sfc/shadowed.vue'),
      'template',
    )
    expect(shadowedResult.code).not.toMatch(/import \{[^}]*\bref\b[^}]*\} from "vue"/)
  })

  // Catches a template that cannot show the totals the embedded XML holds:
  // `computeEInvoice` is auto-imported from the module the build names.
  // Catches a template that must import the e-invoice or rich text functions itself.
  it('injects the e-invoice and rich text functions from the module the build names', async () => {
    const uses = `<script setup lang="ts">
definePdf({})
const props = defineProps<{ invoice: Parameters<typeof computeEInvoice>[0] }>()
const totals = computeEInvoice(props.invoice)
const issues = validateEInvoice(props.invoice, { profile: 'EN 16931' })
const xml = issues.length === 0 ? renderEInvoiceXml(props.invoice, { profile: 'EN 16931' }) : ''
const blocks = parseRichTextHtml('<p>Note</p>')
const problems = validateRichText(blocks)
</script>
<template><PdfDocument><PdfPage><PdfText>{{ totals.grandTotal }} {{ xml.length }} {{ problems.length }}</PdfText></PdfPage></PdfDocument></template>`
    const file = resolve('test/fixtures/pdf-sfc/uses-einvoice.vue')
    const injected = await compilePdfSfc(uses, file, 'template', false, { functionsImport: '/runtime/functions' })
    for (const name of ['computeEInvoice', 'validateEInvoice', 'renderEInvoiceXml', 'parseRichTextHtml', 'validateRichText']) {
      expect(injected.code).toMatch(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "/runtime/functions"`))
    }
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
    const addWatchFile = vi.fn()
    expect(await plugin.load.call({ addWatchFile }, invoiceId!)).toMatchObject({
      code: expect.stringContaining('__nuxtPdf'),
    })
    expect(addWatchFile).toHaveBeenCalledExactlyOnceWith(invoiceFile)
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

  // Wrong behavior caught: the unknown-tag check rejects a Pdf-named component
  // that the file provides in one of the ways Vue resolves a tag.
  const setup = (script: string, template: string) => `<script setup>\n${script}\n</script>\n<template><PdfView>${template}</PdfView></template>`
  const options = (script: string, template: string) => `<script>\n${script}\n</script>\n<template><PdfView>${template}</PdfView></template>`
  it.each([
    { label: 'a <script setup> import', source: setup('import PdfCard from \'./PdfCard.vue\'', '<PdfCard />') },
    { label: 'a <script setup> import used kebab-case', source: setup('import PdfCard from \'./PdfCard.vue\'', '<pdf-card />') },
    { label: 'a namespace import used as a member tag', source: setup('import * as PdfUi from \'./ui\'', '<PdfUi.Card />') },
    { label: 'a <script setup> const', source: setup('const PdfBox = { render: () => null }', '<PdfBox />') },
    { label: 'a kebab-case components key', source: options('import Card from \'./Card.vue\'\nexport default { components: { \'pdf-fancy-card\': Card } }', '<pdf-fancy-card />') },
    { label: 'a camelCase components key used kebab-case', source: options('import Card from \'./Card.vue\'\nexport default { components: { pdfFancyCard: Card } }', '<pdf-fancy-card />') },
    { label: 'a component registered under another name', source: options('import Card from \'./Card.vue\'\nexport default defineComponent({ components: { PdfFancy: Card } })', '<PdfFancy />') },
    { label: 'components through defineOptions', source: setup('import Card from \'./Card.vue\'\ndefineOptions({ components: { PdfFancy: Card } })', '<PdfFancy />') },
    { label: 'components that are not static', source: options('import shared from \'./shared\'\nexport default { components: { ...shared } }', '<PdfAnything />') },
    { label: 'components that a mixin can bring', source: options('import shared from \'./shared\'\nexport default { mixins: [shared] }', '<pdf-shared-card />') },
    { label: 'components that extends can bring', source: options('import Base from \'./Base.vue\'\nexport default { extends: Base, components: {} }', '<PdfBaseCard />') },
    { label: 'options from a variable', source: options('import options from \'./options\'\nexport default options', '<PdfAnything />') },
    { label: 'a dynamic component', source: setup('import PdfCard from \'./PdfCard.vue\'', '<component :is="PdfCard" />') },
    { label: 'a self-reference by a kebab-case file name', source: setup('defineProps([\'n\'])', '<PdfTree v-if="n" :n="n - 1" />'), filename: 'pdf-tree.vue' },
  ])('accepts a Pdf-named component the file provides: $label', async ({ source, filename = 'own-card.vue' }) => {
    await expect(compilePdfSfc(source, resolve(`test/fixtures/pdf-sfc/${filename}`), 'component')).resolves.toBeDefined()
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
      filename: 'custom.vue',
      source: `<script setup>\ndefinePdf({})\n</script>\n<template><PdfDocument /></template>\n<docs>ignored</docs>`,
      message: 'custom.vue:5:7 <docs> custom blocks are not supported in PDF components.',
    },
  ])('rejects unsupported blocks with file and location', async ({ filename, source, message }) => {
    const file = resolve(`test/fixtures/pdf-sfc/${filename}`)

    await expect(compilePdfSfc(source, file, 'template')).rejects.toThrow(message)
  })

  it.each([
    {
      filename: 'async-setup.vue',
      source: `<script setup>\ndefinePdf({})\nconst data = await Promise.resolve('late')\n</script>\n<template><PdfDocument><PdfPage><PdfText>{{ data }}</PdfText></PdfPage></PdfDocument></template>`,
      message: 'async-setup.vue:3:14 Top-level await is not supported in PDF templates.',
    },
    {
      // Vue leaves this call in the code, where it failed at render with "defineOptions is not defined".
      filename: 'options-expression.vue',
      source: `<script setup>\ndefinePdf({})\nvoid defineOptions({ name: 'X' })\n</script>\n<template><PdfDocument /></template>`,
      message: 'options-expression.vue:3:6 defineOptions() must be a standalone top-level statement in <script setup>.',
    },
    {
      filename: 'options-assigned.vue',
      source: `<script setup>\ndefinePdf({})\nconst options = defineOptions({ name: 'X' })\n</script>\n<template><PdfDocument /></template>`,
      message: 'options-assigned.vue:3:17 defineOptions() must be a standalone top-level statement in <script setup>.',
    },
    {
      filename: 'v-show.vue',
      source: `<script setup>\ndefinePdf({})\n</script>\n<template><PdfDocument><PdfPage><PdfText v-show="false">Hidden</PdfText></PdfPage></PdfDocument></template>`,
      message: 'v-show.vue:4:42 v-show is not supported in PDF templates.',
    },
    {
      // Wrong behavior caught: a removed API fails late as "is not defined".
      filename: 'page-numbers.vue',
      source: `<script setup>\ndefinePdf({})\nconst pages = usePdfPageNumbers()\n</script>\n<template><PdfDocument /></template>`,
      message: 'page-numbers.vue:3:15 usePdfPageNumbers() was removed. Print the page of a destination with <PdfPageRef to="id" /> inside a <PdfText>.',
    },
    {
      filename: 'teleport.vue',
      source: `<script setup>\ndefinePdf({})\n</script>\n<template><PdfDocument><PdfPage><Teleport to="body"><PdfText>Lost</PdfText></Teleport></PdfPage></PdfDocument></template>`,
      message: 'teleport.vue:4:33 Teleport is not supported in PDF templates',
    },
    {
      // Wrong behavior caught: an unknown Pdf tag passes the build and fails
      // at render time as "The PDF template definition is invalid."
      filename: 'unknown-tag.vue',
      source: `<script setup>\ndefinePdf({})\n</script>\n<template><PdfDocument><PdfPage><PdfTxt>x</PdfTxt></PdfPage></PdfDocument></template>`,
      message: 'unknown-tag.vue:4:33 Unknown component <PdfTxt>. Did you mean <PdfText>? PDF templates can use the Pdf components of @lupinum/nuxt-pdf and components they import.',
    },
    {
      filename: 'unknown-kebab.vue',
      source: `<script setup>\ndefinePdf({})\n</script>\n<template><PdfDocument><PdfPage><pdf-barcode /></PdfPage></PdfDocument></template>`,
      message: 'unknown-kebab.vue:4:33 Unknown component <pdf-barcode>. PDF templates can use',
    },
    {
      // Registrations of other names do not hide a misspelled built-in.
      filename: 'unknown-registered.vue',
      source: `<script>\nimport Card from './Card.vue'\nexport default { components: { PdfCard: Card } }\n</script>\n<template><PdfView><PdfTxt>x</PdfTxt></PdfView></template>`,
      message: 'unknown-registered.vue:5:20 Unknown component <PdfTxt>. Did you mean <PdfText>?',
    },
    {
      filename: 'unknown-member.vue',
      source: `<script setup>\nimport * as Ui from './ui'\n</script>\n<template><PdfView><PdfUi.Card /></PdfView></template>`,
      message: 'unknown-member.vue:4:20 Unknown component <PdfUi.Card>.',
    },
    {
      // Vue looks a tag up as written, camelCase and PascalCase, never kebab-case.
      filename: 'unknown-form.vue',
      source: `<script>\nimport Card from './Card.vue'\nexport default { components: { 'pdf-fancy-card': Card } }\n</script>\n<template><PdfView><PdfFancyCard /></PdfView></template>`,
      message: 'unknown-form.vue:5:20 Unknown component <PdfFancyCard>.',
    },
  ])('rejects unsupported Vue execution in $filename', async ({ filename, source, message }) => {
    const file = resolve(`test/fixtures/pdf-sfc/${filename}`)

    await expect(compilePdfSfc(source, file, 'template')).rejects.toThrow(message)
  })

  // Wrong behavior caught: a removed prop passes the build and fails only at
  // render time, one occurrence per render round; a binding form or a
  // kebab-case spelling slips through; the position or the hint is wrong.
  it('rejects every removed prop of a file at build time in one error', async () => {
    const template = [
      '<template><PdfDocument><PdfPage>',
      '  <PdfText fixed render="static" />',
      '  <PdfText :render="({ pageNumber }) => pageNumber" />',
      '  <pdf-text v-bind:hyphenation-callback="split">a</pdf-text>',
      '  <PdfView><PdfText :hyphenationCallback="split" hyphenation-callback="x">b</PdfText></PdfView>',
      '  <Footer :render="ownProp" /><PdfText :[dynamic]="x">c</PdfText>',
      '</PdfPage></PdfDocument></template>',
    ].join('\n')
    const source = `<script setup>\ndefinePdf({})\nconst split = (w) => [w]\n</script>\n${template}`
    const filename = resolve('test/fixtures/pdf-sfc/removed-props.vue')
    const render = 'Use <PdfPageNumber /> and <PdfPageCount /> inside the text. Use pages="first" or pages="continuation" on a fixed text to show it on some pages only.'
    const hyphenate = 'Words split only at their soft hyphens, unless the style key hyphens: "auto" splits them by the patterns of the document language.'

    const error = await compilePdfSfc(source, filename, 'template').then(
      () => expect.unreachable('a removed prop must fail the build'),
      (error: unknown) => error,
    )

    expect(error).toBeInstanceOf(PdfSfcCompileError)
    expect(error).toMatchObject({ filename: compilerPath(filename), line: 6, column: 18 })
    expect((error as PdfSfcCompileError).detail).toBe([
      `Unsupported prop "render" on <PdfText>. ${render}`,
      `Also at 7:12: Unsupported prop "render" on <PdfText>. ${render}`,
      `Also at 8:13: Unsupported prop "hyphenation-callback" on <PdfText>. ${hyphenate}`,
      `Also at 9:21: Unsupported prop "hyphenationCallback" on <PdfText>. ${hyphenate}`,
      `Also at 9:50: Unsupported prop "hyphenation-callback" on <PdfText>. ${hyphenate}`,
    ].join('\n'))
  })

  // Wrong behavior caught: a comment or string that names a removed API fails the build.
  it('ignores a removed API name in comments and strings', async () => {
    const source = `<script setup>\ndefinePdf({})\n// was usePdfPageNumbers()\nconst note = 'usePdfPageNumbers'\n</script>\n<template><PdfDocument /></template>`

    await expect(compilePdfSfc(source, resolve('test/fixtures/pdf-sfc/note.vue'), 'template')).resolves.toBeDefined()
  })

  // Wrong behavior caught: the class rewrite lengthens a template line, and a
  // stack position after it mapped to a column right of the real expression.
  it('maps a template expression after a rewritten class to its authored column', async () => {
    const line = '<template><PdfText class="a b" :class="{ a: x }">{{ boomFn() }}</PdfText></template>'
    const source = `<script setup lang="ts">\nconst boomFn = () => 1\nconst x = true\n</script>\n${line}\n<style>\n.a { color: red }\n.b { color: blue }\n</style>\n`
    const result = await compilePdfSfc(source, resolve('test/fixtures/pdf-sfc/mapped.vue'), 'component')
    const lines = result.code.split('\n')
    const generatedLine = lines.findIndex(text => text.includes('boomFn()') && !text.includes('const'))

    expect(originalPositionFor(new TraceMap(result.map!), {
      line: generatedLine + 1,
      column: lines[generatedLine]!.indexOf('boomFn()'),
    })).toMatchObject({ line: 5, column: line.indexOf('boomFn()') })
  })

  // Wrong behavior caught: a Vue column one too far, a template error counted
  // from the <template> block, and messages that repeat a position or path
  // (Vue's code frame and file name, Babel's own "(3:0)").
  const definePdfScript = `<script setup lang="ts">\ndefinePdf({ sampleData: {} })\n</script>\n`
  it.each([
    {
      label: 'an SFC parse error',
      kind: 'template' as const,
      source: `${definePdfScript}\n<template>\n  <PdfDocument><PdfPage><PdfText>x</PdfView></PdfPage></PdfDocument>\n</template>\n`,
      position: { line: 6, column: 35, detail: 'Invalid end tag.' },
    },
    {
      label: 'a template error below the first template line',
      kind: 'template' as const,
      source: `${definePdfScript}\n<template>\n  <PdfDocument>\n    <PdfPage>\n      <PdfText v-for="x">x</PdfText>\n    </PdfPage>\n  </PdfDocument>\n</template>\n`,
      position: { line: 8, column: 16, detail: 'v-for has invalid expression.' },
    },
    {
      label: 'a template error on the line of <template>',
      kind: 'template' as const,
      source: `${definePdfScript}<template><PdfDocument><PdfPage><PdfText v-for="x">x</PdfText></PdfPage></PdfDocument></template>\n`,
      position: { line: 4, column: 42, detail: 'v-for has invalid expression.' },
    },
    {
      label: 'a template error inlined into <script setup>',
      kind: 'component' as const,
      source: `<script setup lang="ts">\nconst a = 1\n</script>\n\n<template>\n  <PdfView>\n    <PdfText v-for="x">{{ a }}</PdfText>\n  </PdfView>\n</template>\n`,
      position: { line: 7, column: 14, detail: 'v-for has invalid expression.' },
    },
    {
      label: 'a script syntax error',
      kind: 'template' as const,
      source: `<script setup lang="ts">\ndefinePdf({ sampleData: {} \n</script>\n<template><PdfDocument /></template>\n`,
      position: { line: 3, column: 1, detail: 'Unexpected token, expected ","' },
    },
    {
      label: 'an empty file',
      kind: 'template' as const,
      source: '',
      position: { line: 1, column: 1, detail: 'At least one <template> or <script> is required in a single file component.' },
    },
  ])('places $label at its authored position', async ({ kind, source, position }) => {
    const filename = resolve('test/fixtures/pdf-sfc/positions.vue')

    await expect(compilePdfSfc(source, filename, kind)).rejects.toMatchObject({ filename: compilerPath(filename), ...position })
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
        filename: compilerPath(filename),
        line: 1,
      })
    }
  })
})

describe('development source positions', () => {
  const root = resolve('test/fixtures/source-positions')
  const fixture = (name: string) => join(root, 'pdfs', name)
  const development = { dev: true, rootDir: root }

  const renderError = async (name: string, options: { dev?: boolean, rootDir?: string }) => {
    const component = await loadCompiledPdfSfc(fixture(name), options)
    return renderPdfTemplate(component, {}).then(
      () => { throw new Error(`${name} rendered without an error.`) },
      (error: unknown) => error as { code?: string, message: string, source?: unknown },
    )
  }

  // Catches an off-by-one from the <template> block offset and a column that
  // is not mapped back through the class rewrite on the same line.
  it('names the template position of a nesting error', async () => {
    const error = await renderError('NestingError.vue', development)

    expect(error.code).toBe('PDF_TREE_INVALID')
    expect(error.message).toContain('<PdfView> cannot contain <PdfPage>')
    expect(error.source).toEqual({ file: 'pdfs/NestingError.vue', line: 9, column: 28 })
  })

  // Catches attributing every error to the root template instead of the
  // local component file that holds the element.
  it('names the local component file of a prop error', async () => {
    const error = await renderError('LocalComponentError.vue', development)

    expect(error.message).toContain('<PdfLink>')
    expect(error.source).toEqual({ file: 'pdfs/components/MissingHref.vue', line: 4, column: 5 })
  })

  // Catches the position being lost in the table components.
  it('names the PdfTableRow of a cell-count error', async () => {
    const error = await renderError('TableRowError.vue', development)

    expect(error.message).toContain('<PdfTableRow> needs 2 columns (counting colspan), but its <PdfTable> declares 1.')
    expect(error.source).toEqual({ file: 'pdfs/TableRowError.vue', line: 9, column: 9 })
  })

  // Catches a tag name read differently from Vue: Vue renders <pdf-View> as
  // PdfView, so it gets a position like any PdfView.
  it('names the position of a PDF component written <pdf-View>', async () => {
    const source = `<script setup>\ndefinePdf({})\n</script>\n<template>\n  <PdfDocument><PdfPage><pdf-View /></PdfPage></PdfDocument>\n</template>\n`
    const { code } = await compilePdfSfc(source, fixture('MixedCase.vue'), 'template', true, development)

    expect(code).toContain('pdfs/MixedCase.vue:5:25')
  })

  // Catches a blanking rule that drops a line break in a file with CRLF line
  // ends: the definePdf statement, the class attributes over four lines and
  // the style block are blanked, and the source map of the expressions after
  // them was lost.
  it('keeps the positions after blanked text in a file with CRLF line ends', async () => {
    const lines = [
      '<script setup lang="ts">',
      'definePdf({',
      '  sampleData: {},',
      '})',
      'const boomFn = () => 1',
      'const x = true',
      '</script>',
      '<template>',
      '  <PdfDocument><PdfPage>',
      '    <PdfText',
      '      class="a',
      '        b"',
      '      :class="{',
      '        a: x }"',
      '    >{{ boomFn() }}</PdfText>',
      '    <PdfText>{{ x }}</PdfText>',
      '  </PdfPage></PdfDocument>',
      '</template>',
      '<style>',
      '.a { color: red }',
      '.b { color: blue }',
      '</style>',
      '',
    ]
    const { code, map } = await compilePdfSfc(lines.join('\r\n'), fixture('Crlf.vue'), 'template', true, development)
    const generated = code.split('\n')
    const position = (needle: string) => {
      const line = generated.findIndex(text => text.includes(needle) && !text.includes('const'))
      return originalPositionFor(new TraceMap(map!), { line: line + 1, column: generated[line]!.indexOf(needle) })
    }

    expect(code.match(/Crlf\.vue:\d+:\d+/g)).toEqual(['Crlf.vue:9:3', 'Crlf.vue:9:16', 'Crlf.vue:10:5', 'Crlf.vue:16:5'])
    expect(position('boomFn()')).toMatchObject({ line: 15, column: 8 })
    expect(position('x)')).toMatchObject({ line: 16, column: 16 })
    await expect(compilePdfSfc(lines.toSpliced(6, 0, 'const y = ;').join('\r\n'), fixture('Crlf.vue'), 'template', true, development))
      .rejects.toMatchObject({ line: 7, column: 11 })
  })

  // Catches positions leaking into production output or errors.
  it('leaves no position in output compiled without the option', async () => {
    const source = await readFile(fixture('NestingError.vue'), 'utf8')
    const production = await compilePdfSfc(source, fixture('NestingError.vue'), 'template', true)
    const withPositions = await compilePdfSfc(source, fixture('NestingError.vue'), 'template', true, development)

    expect(withPositions.code).toContain('pdfs/NestingError.vue:9:28')
    expect(production.code).not.toContain('__nuxtPdfSource')
    expect(production.code).not.toContain('NestingError.vue')

    const error = await renderError('NestingError.vue', {})
    expect(error.code).toBe('PDF_TREE_INVALID')
    expect(error).not.toHaveProperty('source')
  })

  // Catches a warning position lost at the worker boundary or in the engine
  // adapter, and an attribute that changes layout.
  it('names the warning node and keeps the layout unchanged', async () => {
    const upstreamWarning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // One after the other: loadPdfSfc names its temporary module by
      // process and millisecond, so two parallel loads can share one file.
      const withPositions = await renderPdfTemplate(await loadCompiledPdfSfc(fixture('LayoutWarning.vue'), development), {})
      const without = await renderPdfTemplate(await loadCompiledPdfSfc(fixture('LayoutWarning.vue'), {}), {})

      expect(withPositions.result.diagnostics.layoutWarnings).toEqual([
        expect.objectContaining({
          code: 'PDF_UNBREAKABLE_NODE_OVERFLOW',
          source: { file: 'pdfs/LayoutWarning.vue', line: 28, column: 7 },
        }),
      ])
      expect(without.result.diagnostics.layoutWarnings).toHaveLength(1)
      expect(without.result.diagnostics.layoutWarnings[0]).not.toHaveProperty('source')

      const runs = (rendered: typeof without) => rendered.parsed.pages.map(page =>
        page.textRuns.map(({ text, x, y }) => [text, x, y]))
      expect(withPositions.parsed.pages.length).toBeGreaterThan(1)
      expect(runs(withPositions)).toEqual(runs(without))
      // Apart from dates and the file ID, the bytes are the same.
      const stable = (rendered: typeof without) => Buffer.from(rendered.bytes).toString('latin1')
        .replace(/\(D:\d{14}Z\)/g, '')
        .replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/gi, '')
      expect(stable(withPositions)).toBe(stable(without))
    }
    finally {
      upstreamWarning.mockRestore()
    }
  })
})
