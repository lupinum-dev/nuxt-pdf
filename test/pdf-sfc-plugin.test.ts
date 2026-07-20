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
      message: 'styled.vue:5:8 <style> blocks are not supported in PDF components in 0.1.0.',
    },
    {
      filename: 'custom.vue',
      source: `<script setup>\ndefinePdf({})\n</script>\n<template><PdfDocument /></template>\n<docs>ignored</docs>`,
      message: 'custom.vue:5:7 <docs> custom blocks are not supported in PDF components in 0.1.0.',
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
