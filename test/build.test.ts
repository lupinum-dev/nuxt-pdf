import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { h, type Component } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverPdfComponentFiles,
  discoverPdfImageFiles,
  discoverPdfTemplates,
  classifyPdfWatchEvent,
  normalizePdfTemplateCandidates,
  templateKeyFromRelativePath,
  type PdfTemplate,
} from '../src/build/discover-templates'
import {
  generatePdfPreviewConfig,
  generatePdfRegistryTypes,
  generatePdfRuntimeRegistry,
} from '../src/build/generate-registry'
import { loadOptionalPeer } from '../src/build/optional-peer'
import { displayPath } from '../src/build/paths'
import { createPdfSfcEsbuildPlugin, createPdfSfcPlugin, PdfSfcCompileError } from '../src/build/pdf-sfc-plugin'
import { createPdfPreviewEntry, createPdfTemplate } from '../src/runtime/server/registry'
import { DEFAULT_PDF_RENDER_LIMITS } from '../src/runtime/server/render-limits'

const temporaryDirectories: string[] = []

const createLayer = async (
  name: string,
  files: Record<string, string> = {},
): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), `nuxt-pdf-${name}-`))
  temporaryDirectories.push(rootDir)

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(rootDir, ...relativePath.split('/'))
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, contents)
  }

  return rootDir
}

const template = (
  key: string,
  filePath: string,
): PdfTemplate => ({
  key,
  filePath,
  relativePath: `${key}.vue`,
  layerIndex: 0,
  layerName: 'project',
})

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true }),
  ))
})

describe('PDF template discovery', () => {
  it('rediscovers added or removed .vue files, restarts for resource sets and refreshes source edits', () => {
    const rootDir = '/project'
    const layers = [{ name: 'project', rootDir }]

    expect(classifyPdfWatchEvent('change', '/project/pdfs/invoice.vue', layers))
      .toBe('refresh')
    expect(classifyPdfWatchEvent('change', '/project/pdfs/invoice.preview.ts', layers))
      .toBe('refresh')
    expect(classifyPdfWatchEvent('add', '/project/pdfs/new.vue', layers))
      .toBe('rediscover')
    expect(classifyPdfWatchEvent('unlink', '/project/pdfs/reports/old.vue', layers))
      .toBe('rediscover')
    expect(classifyPdfWatchEvent('add', '/project/pdfs/components/Line.vue', layers))
      .toBe('rediscover')
    expect(classifyPdfWatchEvent('add', '/project/pdfs/shared/helpers.ts', layers))
      .toBe('restart')
    expect(classifyPdfWatchEvent('unlinkDir', '/project/pdfs/reports', layers))
      .toBe('restart')
    expect(classifyPdfWatchEvent('add', '/project/pdfs/assets/logo.png', layers))
      .toBe('restart')
    expect(classifyPdfWatchEvent('add', '/project/pdfs/fonts/body.ttf', layers))
      .toBe('restart')
    expect(classifyPdfWatchEvent('change', '/project/pdfs/assets/logo.png', layers))
      .toBe('refresh')
    expect(classifyPdfWatchEvent('change', '/project/pdfs/fonts/body.ttf', layers))
      .toBe('restart')
    expect(classifyPdfWatchEvent('change', '/project/pdfs/private.vue', layers,
      file => file.endsWith('private.vue'))).toBe('ignore')
    expect(classifyPdfWatchEvent('change', '/project/pdfs-other/invoice.vue', layers))
      .toBe('ignore')
  })

  it('normalizes slash template keys from relative paths', () => {
    expect(templateKeyFromRelativePath('reports\\monthly.vue')).toBe(
      'reports/monthly',
    )
    expect(templateKeyFromRelativePath('./invoice.vue')).toBe('invoice')
    expect(templateKeyFromRelativePath('components/LineItem.vue')).toBeNull()
    expect(templateKeyFromRelativePath('assets/logo.vue')).toBeNull()
    expect(templateKeyFromRelativePath('fonts/specimen.vue')).toBeNull()
    expect(templateKeyFromRelativePath('invoice.ts')).toBeNull()
    expect(() => templateKeyFromRelativePath('../outside.vue')).toThrow(
      'must stay inside pdfs/',
    )
  })

  it('discovers deterministically, excludes reserved roots, and applies layer overrides', async () => {
    const project = await createLayer('project', {
      'pdfs/reports/monthly.vue': '<template />',
      'pdfs/invoice.vue': '<template>project</template>',
      'pdfs/components/LineItem.vue': '<template />',
      'pdfs/components/invoice/InvoiceSummary.vue': '<template />',
      'pdfs/assets/logo.vue': '<template />',
      'pdfs/assets/brand/logo.png': 'image',
      'pdfs/fonts/specimen.vue': '<template />',
      'pdfs/readme.txt': 'ignored',
    })
    const base = await createLayer('base', {
      'pdfs/invoice.vue': '<template>base</template>',
      'pdfs/certificate.vue': '<template />',
      'pdfs/assets/brand/logo.png': 'base image',
    })

    const discovered = await discoverPdfTemplates([
      { rootDir: project, name: 'project' },
      { rootDir: base, name: 'base' },
    ])

    expect(discovered.map(item => ({
      key: item.key,
      layerName: item.layerName,
    }))).toEqual([
      {
        key: 'certificate',
        layerName: 'base',
      },
      {
        key: 'invoice',
        layerName: 'project',
      },
      {
        key: 'reports/monthly',
        layerName: 'project',
      },
    ])
    expect(discovered[1]?.filePath).toBe(join(project, 'pdfs/invoice.vue'))
    expect(await discoverPdfComponentFiles([
      { rootDir: project },
      { rootDir: base },
    ])).toEqual([
      join(project, 'pdfs/components/LineItem.vue'),
      join(project, 'pdfs/components/invoice/InvoiceSummary.vue'),
    ])
    expect(await discoverPdfImageFiles([
      { rootDir: project },
      { rootDir: base },
    ])).toEqual([{
      filePath: join(project, 'pdfs/assets/brand/logo.png'),
      key: 'brand/logo.png',
      layerIndex: 0,
      rootDir: join(project, 'pdfs/assets'),
    }])
  })

  it('applies Nuxt ignore decisions to templates, components, and assets', async () => {
    const project = await createLayer('ignored', {
      'pdfs/invoice.vue': '<template />',
      'pdfs/private/secret.vue': '<template />',
      'pdfs/components/Visible.vue': '<template />',
      'pdfs/components/private/Secret.vue': '<template />',
      'pdfs/assets/logo.png': 'visible',
      'pdfs/assets/private/secret.png': 'ignored',
    })
    const ignorePrivate = (file: string) => file.split('/').includes('private')
    const layers = [{ name: 'project', rootDir: project }]

    await expect(discoverPdfTemplates(layers, ignorePrivate)).resolves.toEqual([
      expect.objectContaining({ key: 'invoice' }),
    ])
    await expect(discoverPdfComponentFiles(layers, ignorePrivate)).resolves.toEqual([
      join(project, 'pdfs/components/Visible.vue'),
    ])
    await expect(discoverPdfImageFiles(layers, ignorePrivate)).resolves.toEqual([
      expect.objectContaining({ key: 'logo.png' }),
    ])
  })

  it('fails on key collisions within a layer', () => {
    expect(() => normalizePdfTemplateCandidates([
      {
        filePath: '/project/pdfs/reports/monthly.vue',
        relativePath: 'reports/monthly.vue',
        layerIndex: 0,
      },
      {
        filePath: '/project/pdfs/reports-monthly-copy.vue',
        relativePath: 'reports\\monthly.vue',
        layerIndex: 0,
      },
    ])).toThrow('PDF template collision for "reports/monthly"')
  })

  it('makes normalization independent of candidate input order', () => {
    const candidates = [
      {
        filePath: '/base/pdfs/invoice.vue',
        relativePath: 'invoice.vue',
        layerIndex: 1,
        layerName: 'base',
      },
      {
        filePath: '/project/pdfs/reports/monthly.vue',
        relativePath: 'reports/monthly.vue',
        layerIndex: 0,
        layerName: 'project',
      },
      {
        filePath: '/project/pdfs/invoice.vue',
        relativePath: 'invoice.vue',
        layerIndex: 0,
        layerName: 'project',
      },
    ]

    expect(normalizePdfTemplateCandidates(candidates)).toEqual(
      normalizePdfTemplateCandidates([...candidates].reverse()),
    )
  })
})

describe('PDF registry generation', () => {
  it('derives the preview HMR client from Nuxt app and asset bases', () => {
    expect(generatePdfPreviewConfig('/portal/', '/assets/', '/project')).toBe(
      'export const hmrClientPath = "/portal/assets/@vite/client"\n'
      + 'export const openInEditorPath = "/portal/assets/__open-in-editor"\n'
      + 'export const rootDir = "/project"\n',
    )
    expect(generatePdfPreviewConfig('./', '/_nuxt/', '/project')).toContain(
      'export const hmrClientPath = "/_nuxt/@vite/client"\n',
    )
  })

  const templates = [
    template(
      'reports/monthly',
      '/project/pdfs/reports/monthly.vue',
    ),
    template('invoice', '/project/pdfs/invoice.vue'),
  ]
  const options = {
    development: false,
    runtimeImport: '#pdf-runtime',
  }

  it('generates an exact production registry with only public template handles', () => {
    const source = generatePdfRuntimeRegistry(templates, options)

    expect(source).toBe(
      generatePdfRuntimeRegistry([...templates].reverse(), options),
    )
    expect(source).toBe(`import { createPdfRegistry, createPdfTemplate } from "#pdf-runtime"
import __pdfTemplate0 from "/project/pdfs/invoice.vue"
import __pdfTemplate1 from "/project/pdfs/reports/monthly.vue"

const registry = createPdfRegistry({
  "invoice": createPdfTemplate("invoice", __pdfTemplate0),
  "reports/monthly": createPdfTemplate("reports/monthly", __pdfTemplate1),
})

export const pdf = registry.pdf
export const renderPdf = registry.renderPdf
export const getPdfTemplate = registry.getPdfTemplate
export const pdfTemplateKeys = registry.pdfTemplateKeys
export { NuxtPdfError, PDF_ERROR_CODES, computeEInvoice, renderEInvoiceXml, validateEInvoice } from "#pdf-runtime"
`)
    expect(source).not.toContain('createPdfPreviewEntry')
    expect(source).not.toContain('pdfPreview')
    expect(source).not.toContain('file:')
  })

  it('adds the preview sidecar only to development registries', () => {
    const source = generatePdfRuntimeRegistry(templates, {
      ...options,
      development: true,
    })

    expect(source).toBe(`import { createPdfPreviewEntry, createPdfRegistry, createPdfTemplate } from "#pdf-runtime"
import __pdfTemplate0 from "/project/pdfs/invoice.vue"
import __pdfTemplate1 from "/project/pdfs/reports/monthly.vue"

const registry = createPdfRegistry({
  "invoice": createPdfTemplate("invoice", __pdfTemplate0, { file: "pdfs/invoice.vue" }),
  "reports/monthly": createPdfTemplate("reports/monthly", __pdfTemplate1, { file: "pdfs/reports/monthly.vue" }),
})

export const pdfPreview = Object.freeze({
  "invoice": createPdfPreviewEntry(registry.pdf["invoice"], __pdfTemplate0, { file: "pdfs/invoice.vue" }),
  "reports/monthly": createPdfPreviewEntry(registry.pdf["reports/monthly"], __pdfTemplate1, { file: "pdfs/reports/monthly.vue" }),
})

export const pdf = registry.pdf
export const renderPdf = registry.renderPdf
export const getPdfTemplate = registry.getPdfTemplate
export const pdfTemplateKeys = registry.pdfTemplateKeys
export { NuxtPdfError, PDF_ERROR_CODES, computeEInvoice, renderEInvoiceXml, validateEInvoice } from "#pdf-runtime"
`)
    expect(source).toContain('{ file: "pdfs/invoice.vue" }')
  })

  it('keeps development source attribution when runtime options are present', () => {
    const source = generatePdfRuntimeRegistry(templates, {
      ...options,
      development: true,
      limits: {
        ...DEFAULT_PDF_RENDER_LIMITS,
        maxPages: 20,
        timeoutMs: 1_000,
      },
    })

    expect(source).toContain(
      'createPdfTemplate("invoice", __pdfTemplate0, { ...__pdfRuntimeOptions, file: "pdfs/invoice.vue" })',
    )
  })

  it('embeds production asset bytes and fonts without source-tree paths', () => {
    const source = generatePdfRuntimeRegistry(templates, {
      assets: [{
        dataB64: 'AQID',
        format: 'png',
        key: 'brand/logo.png',
      }],
      fonts: [{
        family: 'Invoice Sans',
        src: 'data:font/ttf;base64,AAEAAA==',
      }],
      development: false,
      runtimeImport: '#pdf-runtime',
    })

    expect(source).toContain('"brand/logo.png": Object.freeze({ dataB64: "AQID", format: "png" })')
    expect(source).toContain('"Invoice Sans"')
    expect(source).toContain(
      '"invoice": createPdfTemplate("invoice", __pdfTemplate0, __pdfRuntimeOptions)',
    )
    expect(source).not.toContain('file:')
    expect(source).not.toContain('/project/pdfs/assets')
    expect(source).not.toContain('/project/pdfs/fonts')
  })

  it('points development assets at their disk roots for edit-fresh renders', () => {
    const source = generatePdfRuntimeRegistry(templates, {
      assets: [{
        format: 'png',
        key: 'brand/logo.png',
        root: '/project/pdfs/assets',
      }],
      development: true,
      runtimeImport: '#pdf-runtime',
    })

    expect(source).toContain(
      '"brand/logo.png": Object.freeze({ format: "png", root: "/project/pdfs/assets" })',
    )
    expect(source).not.toContain('dataB64')
  })

  it('rejects asset entries without exactly one source form', () => {
    expect(() => generatePdfRuntimeRegistry(templates, {
      assets: [{ format: 'png', key: 'brand/logo.png' }],
      development: true,
      runtimeImport: '#pdf-runtime',
    })).toThrow(/exactly one of root or dataB64/)

    expect(() => generatePdfRuntimeRegistry(templates, {
      assets: [{
        dataB64: 'AQID',
        format: 'png',
        key: 'brand/logo.png',
        root: '/project/pdfs/assets',
      }],
      development: true,
      runtimeImport: '#pdf-runtime',
    })).toThrow(/exactly one of root or dataB64/)
  })

  it('generates typed key access and an explicit dynamic escape hatch', () => {
    const source = generatePdfRegistryTypes(templates, options)

    expect(source).toContain(
      'import type { PdfComponentProps, PdfRenderResult, PdfTemplate } from "#pdf-runtime"',
    )
    expect(source).toContain(
      'type PdfProps0 = PdfComponentProps<PdfComponent0>',
    )
    expect(source).toContain(
      'readonly "reports/monthly": PdfTemplate<PdfProps1>',
    )
    expect(source).toContain(
      'renderPdf(name: "reports/monthly", props: PdfProps1)',
    )
    expect(source).toContain(
      'getPdfTemplate(name: "invoice"): PdfTemplate<PdfProps0>',
    )
    expect(source).toContain(
      'pdfTemplateKeys: readonly ["invoice", "reports/monthly"]',
    )
    expect(source).toContain(
      'renderPdf(name: string, props: Record<string, unknown>, escapeHatch: { readonly unsafe: true })',
    )
    expect(source).not.toContain(
      'renderPdf(name: string, props: Record<string, unknown>):',
    )
  })

  it('rejects ambiguous registry input', () => {
    expect(() => generatePdfRuntimeRegistry([
      template('invoice', '/project/pdfs/invoice.vue'),
      template('invoice', '/other/pdfs/invoice.vue'),
    ], options)).toThrow('Cannot generate duplicate PDF template key "invoice"')

    expect(() => generatePdfRegistryTypes([], {
      runtimeImport: ' ',
    })).toThrow('runtimeImport is required')
  })
})

describe('optional build peers', () => {
  it('names the missing peer and how to install it, and keeps other load errors', async () => {
    const missing = Object.assign(new Error('Cannot find package \'vue-tsc\''), { code: 'ERR_MODULE_NOT_FOUND' })
    await expect(loadOptionalPeer('vue-tsc', 'to emit the prop types of PDF templates', () => {
      throw missing
    })).rejects.toThrow('@lupinum/nuxt-pdf/build needs "vue-tsc" to emit the prop types of PDF templates. Install it: pnpm add -D vue-tsc')
    const broken = new SyntaxError('Unexpected token')
    await expect(loadOptionalPeer('typescript', 'to read types', () => Promise.reject(broken))).rejects.toBe(broken)
  })
})

describe('development compile recovery', () => {
  // Catches a production build that ships a stub instead of failing, and a
  // development stub that no longer names the file, line and column.
  it('fails the build without the option, and turns a failed file into a typed render error with it', async () => {
    const rootDir = await createLayer('recovery', {
      'pdfs/broken.vue': '<script setup lang="ts">\nconst unused = 1\n</script>\n<template><PdfDocument /></template>\n',
      'pdfs/components/Part.vue': '<template>\n  <PdfText>Part</PdfView>\n</template>\n',
    })
    const broken = join(rootDir, 'pdfs/broken.vue')
    const partFile = join(rootDir, 'pdfs/components/Part.vue')
    const files = new Map([[broken, 'template'], [partFile, 'component']] as const)
    const context = { addWatchFile: () => {} }

    const production = createPdfSfcPlugin({ files, isProduction: true, rootDir })
    await expect(production.load.call(context, production.resolveId(broken)!)).rejects.toBeInstanceOf(PdfSfcCompileError)
    // Nitro prints the frame of a failed build, and "undefined" without one.
    await expect(production.load.call(context, production.resolveId(broken)!)).rejects.toMatchObject({
      frame: expect.stringMatching(/^1 {2}\| {2}<script setup lang="ts">\n {3}\| {26}\^/),
    })

    const reported: string[] = []
    const dev = createPdfSfcPlugin({ files, dev: true, rootDir, onCompileError: error => reported.push(error.message) })
    const load = async (file: string): Promise<Component> => {
      const result = await dev.load.call(context, dev.resolveId(file)!)
      const stub = join(rootDir, `${basename(file)}.mjs`)
      await writeFile(stub, result!.code)
      return (await import(pathToFileURL(stub).href)).default
    }
    const template = createPdfTemplate('broken', await load(broken), { file: 'pdfs/broken.vue' })
    expect(reported).toEqual([`[nuxt-pdf] ${displayPath(broken)}:1:25 A PDF template must contain exactly one top-level definePdf({...}) call.`])
    await expect(template.render({})).rejects.toMatchObject({
      code: 'PDF_TEMPLATE_INVALID',
      source: { file: 'pdfs/broken.vue', line: 1, column: 25 },
    })
    const entry = createPdfPreviewEntry(template, await load(broken), { file: 'pdfs/broken.vue' })
    expect(entry.compileError).toEqual({
      message: 'A PDF template must contain exactly one top-level definePdf({...}) call.',
      source: { file: 'pdfs/broken.vue', line: 1, column: 25 },
    })

    // A template that renders a failed component fails with the component's position.
    const part = await load(partFile)
    const usesPart = createPdfTemplate('uses-part', { __nuxtPdf: {}, render: () => h(part) }, { file: 'pdfs/uses-part.vue' })
    await expect(usesPart.render({})).rejects.toMatchObject({
      code: 'PDF_TEMPLATE_INVALID',
      source: { file: 'pdfs/components/Part.vue', line: 2, column: 16 },
    })

    await rm(broken)
    const removed = await dev.load.call(context, dev.resolveId(broken)!)
    expect(removed?.code).toContain('This file was removed.')
    await expect(production.load.call(context, production.resolveId(broken)!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  // Catches a missing import that reaches Rollup in development (it stops the
  // dev server), a production or standalone build that names the virtual
  // module or the compiled position instead of the import, and a terminal
  // that repeats a still-broken file on every rebuild.
  it('turns an import the bundler cannot resolve into a failed file, reported when it breaks or changes', async () => {
    const script = (specifier: string) => `<script setup lang="ts">\nimport { format } from '${specifier}'\ndefinePdf({ sampleData: {} })\nconst text = format('x')\n</script>\n<template><PdfDocument><PdfPage><PdfText>{{ text }}</PdfText></PdfPage></PdfDocument></template>\n`
    const rootDir = await createLayer('imports', { 'pdfs/imports.vue': script('./helpers/formt') })
    const file = join(rootDir, 'pdfs/imports.vue')
    const files = new Map([[file, 'template']] as const)
    const missing = new Set(['./helpers/formt', 'not-installed'])
    const context = {
      addWatchFile: () => {},
      resolve: async (source: string) => missing.has(source) ? null : { id: source },
    }
    const reported: string[] = []
    const dev = createPdfSfcPlugin({ files, dev: true, rootDir, onCompileError: error => reported.push(error.message) })
    const load = async () => (await dev.load.call(context, dev.resolveId(file)!))!.code
    const message = (specifier: string) => `[nuxt-pdf] ${displayPath(file)}:2:24 Cannot resolve the import "${specifier}". Check the path or alias, and that the package is installed.`

    expect(await load()).toContain('NuxtPdfCompileError')
    expect(await load()).toContain('"line":2,"column":24')
    expect(reported).toEqual([message('./helpers/formt')])

    await writeFile(file, script('not-installed'))
    await load()
    expect(reported).toEqual([message('./helpers/formt'), message('not-installed')])

    missing.clear()
    expect(await load()).not.toContain('NuxtPdfCompileError')
    missing.add('not-installed')
    await load()
    expect(reported).toHaveLength(3)

    // Production and the standalone build fail with the same message and position.
    const production = createPdfSfcPlugin({ files, isProduction: true, rootDir })
    await expect(production.load.call(context, production.resolveId(file)!)).rejects.toThrow(message('not-installed'))
    await writeFile(file, script('./helpers/formt'))
    await expect(build({
      entryPoints: [file],
      bundle: true,
      packages: 'external',
      write: false,
      plugins: [createPdfSfcEsbuildPlugin({ kind: () => 'template' })],
    })).rejects.toThrow('pdfs/imports.vue:2:24 Cannot resolve the import "./helpers/formt".')
  })

  // Catches a helper module that fails to transform and takes the whole dev
  // build down instead of failing the template that imports it, at the
  // helper's own position.
  it('turns a local module that fails to transform into a failed file at the module position', async () => {
    const rootDir = await createLayer('helper', {
      'pdfs/uses-helper.vue': `<script setup lang="ts">\nimport { x } from './helpers/bad'\ndefinePdf({ sampleData: {} })\n</script>\n<template><PdfDocument><PdfPage><PdfText>{{ x }}</PdfText></PdfPage></PdfDocument></template>\n`,
    })
    const file = join(rootDir, 'pdfs/uses-helper.vue')
    const helper = join(rootDir, 'pdfs/helpers/bad.ts')
    const watched: string[] = []
    // Shaped as Rollup passes on esbuild's transform failure.
    const failure = Object.assign(new Error(`Transform failed with 1 error:\n${helper}:2:0: ERROR: Unexpected end of file`), {
      errors: [{ text: 'Unexpected end of file', location: { file: helper, line: 2, column: 0 } }],
    })
    const context = {
      addWatchFile: (path: string) => watched.push(path),
      resolve: async () => ({ id: helper, external: false }),
      load: async () => {
        throw failure
      },
    }
    const reported: string[] = []
    const dev = createPdfSfcPlugin({ files: new Map([[file, 'template']]), dev: true, rootDir, onCompileError: error => reported.push(error.message) })
    const code = (await dev.load.call(context, dev.resolveId(file)!))!.code

    expect(code).toContain('NuxtPdfCompileError')
    expect(code).toContain('"file":"pdfs/helpers/bad.ts","line":2,"column":1')
    expect(reported).toEqual([`[nuxt-pdf] ${displayPath(helper)}:2:1 Unexpected end of file`])
    expect(watched).toContain(helper)
  })

  // Catches a definePdf value that fails validation and takes the whole dev
  // registry down, and a production registry that loads such a template.
  it('fails only the template whose definePdf value is invalid when a development build marked it', async () => {
    const definition = { sampleData: {}, maxPasses: 0 }
    const source = { file: 'pdfs/invalid.vue', line: 2, column: 1 }
    const development = { __nuxtPdf: definition, __nuxtPdfDefinitionSource: source, render: () => null }
    const template = createPdfTemplate('invalid', development, { file: 'pdfs/invalid.vue' })
    await expect(template.render({})).rejects.toMatchObject({ code: 'PDF_TEMPLATE_INVALID', source })
    expect(createPdfPreviewEntry(template, development, { file: 'pdfs/invalid.vue' }).compileError).toEqual({
      message: 'maxPasses must be a positive integer.',
      source,
    })
    expect(() => createPdfTemplate('invalid', { __nuxtPdf: definition, render: () => null })).toThrow('maxPasses must be a positive integer.')
  })
})
