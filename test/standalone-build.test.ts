import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPdfRegistry } from '@lupinum/nuxt-pdf/build'
import { renderPdfSfc } from '../src/test/render-sfc'
import { parsePdf } from '../src/test/pdf'
import type { PdfTemplate } from '../src/runtime/shared/template'

const execute = promisify(execFile)
const directories: string[] = []
const fonts = [{ family: 'Invoice Sans', src: 'Roboto-Regular.ttf' }]
const props = {
  customer: 'Grüße — école',
  number: 'STANDALONE',
  lines: Array.from({ length: 48 }, (_, index) => ({ id: String(index), description: `Shared renderer ${index} with enough text to exercise document flow and pagination.`, price: '42' })),
}

async function fixture() {
  await mkdir('.tmp', { recursive: true })
  const rootDir = await mkdtemp(resolve('.tmp/standalone-'))
  directories.push(rootDir)
  await cp('test/fixtures/basic/pdfs', join(rootDir, 'pdfs'), { recursive: true })
  await rm(join(rootDir, 'pdfs/production-error.vue'))
  return { rootDir, outDir: join(rootDir, 'generated') }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('standalone production registry', () => {
  it('renders embedded fonts/images after source removal with equivalent content and isolated concurrent props', async () => {
    const options = await fixture()
    const source = await renderPdfSfc(join(options.rootDir, 'pdfs/invoice.vue'), props, { fonts })
    await buildPdfRegistry({ ...options, fonts })
    const code = await readFile(join(options.outDir, 'index.mjs'), 'utf8')
    expect(/compiler-sfc|esbuild|nuxt-pdf\/test|#pdf|sampleData|NUXT_PDF_PREVIEW/.test(code)).toBe(false)
    await rm(join(options.rootDir, 'pdfs'), { recursive: true })
    const registry: { pdf: { invoice: PdfTemplate<typeof props> } } = await import(pathToFileURL(join(options.outDir, 'index.mjs')).href)
    const [first, second] = await Promise.all([
      registry.pdf.invoice.render(props),
      registry.pdf.invoice.render({ ...props, customer: 'Other recipient' }),
    ])
    const parsed = await parsePdf(await first.toUint8Array())
    const text = (document: typeof parsed) => document.pages.flatMap(page => page.textRuns.map(run => run.text)).join(' ')
    expect(text(parsed)).toBe(text(source.parsed))
    const layout = (document: typeof parsed) => document.pages.map(page => page.textRuns.map(({ fontName: _fontName, ...run }) => run))
    expect(layout(parsed)).toEqual(layout(source.parsed))
    expect(first.diagnostics.pageCount).toBe(source.result.diagnostics.pageCount)
    expect(first.diagnostics.pageCount).toBeGreaterThan(1)
    expect(first.diagnostics.registeredFontFaces).toEqual(source.result.diagnostics.registeredFontFaces)
    expect(text(await parsePdf(await second.toUint8Array()))).toContain('Other recipient')
    expect(text(parsed)).not.toContain('Other recipient')
  }, 60_000)

  it('emits declarations checked by ordinary backend TypeScript without Vue source', async () => {
    const options = await fixture()
    await mkdir(join(options.rootDir, 'pdfs/shared'))
    await writeFile(join(options.rootDir, 'pdfs/shared/index.ts'), `export interface ReportProps { title: string; kind: 'summary' | 'full' }\n`)
    await writeFile(join(options.rootDir, 'pdfs/report.vue'), `<script setup lang="ts">
import type { ReportProps } from './shared'
defineProps<ReportProps>()
definePdf<ReportProps>({})
</script>
<template><PdfDocument><PdfPage><PdfText>{{ title }} {{ kind }}</PdfText></PdfPage></PdfDocument></template>
`)
    await buildPdfRegistry({ ...options, fonts })
    await rm(join(options.rootDir, 'pdfs'), { recursive: true })
    await writeFile(join(options.rootDir, 'consumer.mts'), `
import { pdf } from './generated/index.mjs'
pdf.invoice.render({ customer: 'Typed', number: '1', lines: [] })
// @ts-expect-error required customer is absent
pdf.invoice.render({ number: '1', lines: [] })
// @ts-expect-error number prop is a string
pdf.invoice.render({ customer: 'Typed', number: 1, lines: [] })
pdf.report.render({ title: 'Typed', kind: 'summary' })
// @ts-expect-error imported required prop stays required
pdf.report.render({ kind: 'summary' })
// @ts-expect-error imported literal union stays narrow
pdf.report.render({ title: 'Typed', kind: 'invalid' })
// @ts-expect-error unknown template name
pdf.unknown.render({})
`)
    const checked = await execute(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--target', 'ES2022', join(options.rootDir, 'consumer.mts')]).catch((error: unknown) => {
      throw new Error(error instanceof Error && 'stdout' in error ? String(error.stdout) : 'Type check failed', { cause: error })
    })
    expect(checked.stderr).toBe('')
  }, 60_000)

  it('preserves runtime output limits and rejects invalid build resources', async () => {
    const options = await fixture()
    await expect(buildPdfRegistry({ ...options, fonts, limits: { maxImageBytes: 1 } })).rejects.toThrow()
    await expect(buildPdfRegistry({ ...options, fonts: [{ family: 'Invalid', src: '../outside.ttf' }] })).rejects.toThrow('parent path')
    await buildPdfRegistry({ ...options, fonts, limits: { maxOutputBytes: 100 } })
    const registry: { pdf: { invoice: PdfTemplate<typeof props> } } = await import(pathToFileURL(join(options.outDir, 'index.mjs')).href)
    await expect(registry.pdf.invoice.render(props)).rejects.toMatchObject({ code: 'PDF_LIMIT_EXCEEDED' })
  }, 60_000)

  it('rejects missing templates and source-overlapping output', async () => {
    const options = await fixture()
    await expect(buildPdfRegistry({ ...options, outDir: join(options.rootDir, 'pdfs/output') })).rejects.toThrow('outside pdfs')
    await rm(join(options.rootDir, 'pdfs'), { recursive: true })
    await expect(buildPdfRegistry(options)).rejects.toThrow('no templates')
  })

  it('preserves previous output on failure and refuses unowned output directories', async () => {
    const options = await fixture()
    await mkdir(options.outDir)
    await writeFile(join(options.outDir, 'keep.txt'), 'User-owned file')
    await expect(buildPdfRegistry(options)).rejects.toThrow('did not generate')
    expect(await readFile(join(options.outDir, 'keep.txt'), 'utf8')).toBe('User-owned file')
    await rm(join(options.outDir, 'keep.txt'))
    await buildPdfRegistry({ ...options, fonts })
    const original = await readFile(join(options.outDir, 'index.mjs'), 'utf8')
    await writeFile(join(options.rootDir, 'pdfs/broken.vue'), '<script setup lang="ts">const value: string = 1; definePdf({})</script><template><PdfDocument><PdfPage><PdfText>{{ value }}</PdfText></PdfPage></PdfDocument></template>')
    await expect(buildPdfRegistry({ ...options, fonts })).rejects.toThrow('type checking failed')
    expect(await readFile(join(options.outDir, 'index.mjs'), 'utf8')).toBe(original)
    await rm(join(options.rootDir, 'pdfs/broken.vue'))
    await writeFile(join(options.outDir, 'types/stale.d.ts'), 'export {}')
    await buildPdfRegistry({ ...options, fonts })
    await expect(readFile(join(options.outDir, 'types/stale.d.ts'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 60_000)
})
