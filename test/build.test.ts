import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalKeyFromRelativePath,
  discoverPdfComponentFiles,
  discoverPdfImageFiles,
  discoverPdfTemplates,
  normalizePdfTemplateCandidates,
  propertyKeyFromCanonicalKey,
  type PdfTemplate,
} from '../src/build/discover-templates'
import {
  generatePdfRegistryTypes,
  generatePdfRuntimeRegistry,
} from '../src/build/generate-registry'

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
  canonicalKey: string,
  propertyKey: string,
  filePath: string,
): PdfTemplate => ({
  canonicalKey,
  propertyKey,
  filePath,
  relativePath: `${canonicalKey}.vue`,
  layerIndex: 0,
  layerName: 'project',
})

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true }),
  ))
})

describe('PDF template discovery', () => {
  it('normalizes canonical and camel property keys', () => {
    expect(canonicalKeyFromRelativePath('reports\\monthly.vue')).toBe(
      'reports/monthly',
    )
    expect(canonicalKeyFromRelativePath('./invoice.vue')).toBe('invoice')
    expect(canonicalKeyFromRelativePath('components/LineItem.vue')).toBeNull()
    expect(canonicalKeyFromRelativePath('assets/logo.vue')).toBeNull()
    expect(canonicalKeyFromRelativePath('fonts/specimen.vue')).toBeNull()
    expect(canonicalKeyFromRelativePath('invoice.ts')).toBeNull()
    expect(propertyKeyFromCanonicalKey('reports/monthly-summary')).toBe(
      'reportsMonthlySummary',
    )
    expect(propertyKeyFromCanonicalKey('2026/summary')).toBe('_2026Summary')
    expect(() => canonicalKeyFromRelativePath('../outside.vue')).toThrow(
      'must stay inside pdfs/',
    )
  })

  it('discovers deterministically, excludes reserved roots, and applies layer overrides', async () => {
    const project = await createLayer('project', {
      'pdfs/reports/monthly.vue': '<template />',
      'pdfs/invoice.vue': '<template>project</template>',
      'pdfs/components/LineItem.vue': '<template />',
      'pdfs/assets/logo.vue': '<template />',
      'pdfs/assets/brand/logo.png': 'image',
      'pdfs/fonts/specimen.vue': '<template />',
      'pdfs/readme.txt': 'ignored',
    })
    const base = await createLayer('base', {
      'pdfs/invoice.vue': '<template>base</template>',
      'pdfs/certificate.vue': '<template />',
    })

    const discovered = await discoverPdfTemplates([
      { rootDir: project, name: 'project' },
      { rootDir: base, name: 'base' },
    ])

    expect(discovered.map(item => ({
      canonicalKey: item.canonicalKey,
      propertyKey: item.propertyKey,
      layerName: item.layerName,
    }))).toEqual([
      {
        canonicalKey: 'certificate',
        propertyKey: 'certificate',
        layerName: 'base',
      },
      {
        canonicalKey: 'invoice',
        propertyKey: 'invoice',
        layerName: 'project',
      },
      {
        canonicalKey: 'reports/monthly',
        propertyKey: 'reportsMonthly',
        layerName: 'project',
      },
    ])
    expect(discovered[1]?.filePath).toBe(join(project, 'pdfs/invoice.vue'))
    expect(await discoverPdfComponentFiles([
      { rootDir: project },
      { rootDir: base },
    ])).toEqual([
      join(project, 'pdfs/components/LineItem.vue'),
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

  it('fails on canonical and property collisions', () => {
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

    expect(() => normalizePdfTemplateCandidates([
      {
        filePath: '/project/pdfs/reports/monthly.vue',
        relativePath: 'reports/monthly.vue',
        layerIndex: 0,
      },
      {
        filePath: '/project/pdfs/reports-monthly.vue',
        relativePath: 'reports-monthly.vue',
        layerIndex: 0,
      },
    ])).toThrow('PDF template property collision for "reportsMonthly"')
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
  const templates = [
    template(
      'reports/monthly',
      'reportsMonthly',
      '/project/pdfs/reports/monthly.vue',
    ),
    template('invoice', 'invoice', '/project/pdfs/invoice.vue'),
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
  "reportsMonthly": createPdfTemplate("reports/monthly", __pdfTemplate1),
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
  "reportsMonthly": createPdfTemplate("reports/monthly", __pdfTemplate1, { file: "pdfs/reports/monthly.vue" }),
})

export const pdfPreview = Object.freeze({
  "invoice": createPdfPreviewEntry(registry.pdf["invoice"], __pdfTemplate0, { file: "pdfs/invoice.vue" }),
  "reportsMonthly": createPdfPreviewEntry(registry.pdf["reportsMonthly"], __pdfTemplate1, { file: "pdfs/reports/monthly.vue" }),
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
      limits: { maxPages: 20, timeoutMs: 1_000 },
    })

    expect(source).toContain(
      'createPdfTemplate("invoice", __pdfTemplate0, { ...__pdfRuntimeOptions, file: "pdfs/invoice.vue" })',
    )
  })

  it('embeds validated assets and fonts without source-tree paths', () => {
    const source = generatePdfRuntimeRegistry(templates, {
      assets: [{
        data: new Uint8Array([1, 2, 3]),
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

    expect(source).toContain('Buffer as __pdfBuffer')
    expect(source).toContain('__pdfBuffer.from("AQID", \'base64\')')
    expect(source).toContain('"brand/logo.png"')
    expect(source).toContain('"Invoice Sans"')
    expect(source).toContain(
      '"invoice": createPdfTemplate("invoice", __pdfTemplate0, __pdfRuntimeOptions)',
    )
    expect(source).not.toContain('file:')
    expect(source).not.toContain('/project/pdfs/assets')
    expect(source).not.toContain('/project/pdfs/fonts')
  })

  it('generates typed property access and an explicit dynamic escape hatch', () => {
    const source = generatePdfRegistryTypes(templates, options)

    expect(source).toContain(
      'import type { PdfRenderResult, PdfTemplate } from "#pdf-runtime"',
    )
    expect(source).toContain(
      'readonly "reportsMonthly": PdfTemplate<PdfProps1>',
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
      template('invoice', 'invoice', '/project/pdfs/invoice.vue'),
      template('invoice', 'invoiceCopy', '/other/pdfs/invoice.vue'),
    ], options)).toThrow('Cannot generate duplicate PDF template key "invoice"')

    expect(() => generatePdfRegistryTypes([], {
      runtimeImport: ' ',
    })).toThrow('runtimeImport is required')
  })
})
