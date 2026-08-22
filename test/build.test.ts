import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  it('restarts for discovery/resource changes and refreshes source edits', () => {
    const rootDir = '/project'
    const layers = [{ name: 'project', rootDir }]

    expect(classifyPdfWatchEvent('change', '/project/pdfs/invoice.vue', layers))
      .toBe('refresh')
    expect(classifyPdfWatchEvent('change', '/project/pdfs/invoice.preview.ts', layers))
      .toBe('refresh')
    expect(classifyPdfWatchEvent('add', '/project/pdfs/new.vue', layers))
      .toBe('restart')
    expect(classifyPdfWatchEvent('unlink', '/project/pdfs/old.vue', layers))
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
    expect(generatePdfPreviewConfig('/portal/', '/assets/')).toBe(
      'export const hmrClientPath = "/portal/assets/@vite/client"\n',
    )
    expect(generatePdfPreviewConfig('./', '/_nuxt/')).toBe(
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
export { NuxtPdfError, PDF_ERROR_CODES } from "#pdf-runtime"
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
export { NuxtPdfError, PDF_ERROR_CODES } from "#pdf-runtime"
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
