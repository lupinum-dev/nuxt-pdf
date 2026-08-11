import { Buffer } from 'node:buffer'
import type { RemoteAssetPolicy } from '../runtime/server/assets/remote'
import type { PdfRenderLimits } from '../runtime/server/render-limits'
import type { PdfTemplate } from './discover-templates'

export type PdfRegistryTypeGenerationOptions = {
  runtimeImport: string
}

export type PdfRegistryGenerationOptions = PdfRegistryTypeGenerationOptions & {
  assets?: readonly {
    data: Uint8Array
    format: 'jpg' | 'png'
    key: string
  }[]
  fonts?: readonly {
    family: string
    fontStyle?: 'italic' | 'normal' | 'oblique'
    fontWeight?: number
    src: string
  }[]
  remote?: RemoteAssetPolicy
  limits?: PdfRenderLimits
  development: boolean
}

const compareText = (left: string, right: string): number => {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

const quote = (value: string): string => JSON.stringify(value)

const importPath = (filePath: string): string =>
  filePath.replaceAll('\\', '/')

const runtimeOptionsSource = (
  options: PdfRegistryGenerationOptions,
): string[] => {
  const assets = options.assets ?? []
  const fonts = options.fonts ?? []
  const { remote, limits } = options

  if (assets.length === 0 && fonts.length === 0 && !remote && !limits) return []

  const lines = ['', 'const __pdfRuntimeOptions = Object.freeze({']

  if (assets.length > 0) {
    lines.push('  assets: Object.freeze({')
    for (const asset of assets) {
      lines.push(
        `    ${quote(asset.key)}: Object.freeze({ data: __pdfBuffer.from(${quote(Buffer.from(asset.data).toString('base64'))}, 'base64'), format: ${quote(asset.format)} }),`,
      )
    }
    lines.push('  }),')
  }

  if (fonts.length > 0) {
    lines.push('  fonts: Object.freeze([')
    for (const font of fonts) {
      lines.push(`    Object.freeze(${JSON.stringify(font)}),`)
    }
    lines.push('  ]),')
  }

  if (remote) {
    lines.push(`  remote: Object.freeze(${JSON.stringify(remote)}),`)
  }

  if (limits) {
    lines.push(`  limits: Object.freeze(${JSON.stringify(limits)}),`)
  }

  lines.push('})')
  return lines
}

const orderedTemplates = (
  templates: readonly PdfTemplate[],
): PdfTemplate[] => {
  const result = [...templates].sort((left, right) =>
    compareText(left.key, right.key),
  )
  const keys = new Map<string, PdfTemplate>()

  for (const template of result) {
    const duplicate = keys.get(template.key)
    if (duplicate) {
      throw new TypeError(
        `Cannot generate duplicate PDF template key "${template.key}" from "${duplicate.filePath}" and "${template.filePath}".`,
      )
    }
    keys.set(template.key, template)
  }

  return result
}

const validateOptions = (options: PdfRegistryTypeGenerationOptions) => {
  if (options.runtimeImport.trim() === '') {
    throw new TypeError('runtimeImport is required to generate the PDF registry.')
  }
}

export const generatePdfRuntimeRegistry = (
  templates: readonly PdfTemplate[],
  options: PdfRegistryGenerationOptions,
): string => {
  validateOptions(options)
  const ordered = orderedTemplates(templates)
  const runtimeImports = options.development
    ? 'createPdfPreviewEntry, createPdfRegistry, createPdfTemplate'
    : 'createPdfRegistry, createPdfTemplate'
  const lines = [
    `import { ${runtimeImports} } from ${quote(options.runtimeImport)}`,
  ]

  if ((options.assets?.length ?? 0) > 0) {
    lines.push('import { Buffer as __pdfBuffer } from \'node:buffer\'')
  }

  ordered.forEach((template, index) => {
    lines.push(
      `import __pdfTemplate${index} from ${quote(importPath(template.filePath))}`,
    )
  })

  const runtimeOptions = runtimeOptionsSource(options)
  lines.push(...runtimeOptions, '', 'const registry = createPdfRegistry({')

  ordered.forEach((template, index) => {
    const file = quote(`pdfs/${template.relativePath}`)
    const runtimeArgument = options.development
      ? runtimeOptions.length > 0
        ? `, { ...__pdfRuntimeOptions, file: ${file} }`
        : `, { file: ${file} }`
      : runtimeOptions.length > 0
        ? ', __pdfRuntimeOptions'
        : ''
    lines.push(
      `  ${quote(template.key)}: createPdfTemplate(${quote(template.key)}, __pdfTemplate${index}${runtimeArgument}),`,
    )
  })

  lines.push('})')

  if (options.development) {
    lines.push('', 'export const pdfPreview = Object.freeze({')
    ordered.forEach((template, index) => {
      lines.push(
        `  ${quote(template.key)}: createPdfPreviewEntry(registry.pdf[${quote(template.key)}], __pdfTemplate${index}, { file: ${quote(`pdfs/${template.relativePath}`)} }),`,
      )
    })
    lines.push('})')
  }

  lines.push(
    '',
    'export const pdf = registry.pdf',
    'export const renderPdf = registry.renderPdf',
    'export const getPdfTemplate = registry.getPdfTemplate',
    'export const pdfTemplateKeys = registry.pdfTemplateKeys',
    `export { NuxtPdfError, PDF_ERROR_CODES } from ${quote(options.runtimeImport)}`,
    '',
  )

  return lines.join('\n')
}

export const generatePdfRegistryTypes = (
  templates: readonly PdfTemplate[],
  options: PdfRegistryTypeGenerationOptions,
): string => {
  validateOptions(options)
  const ordered = orderedTemplates(templates)
  const lines = [
    `import type { PdfComponentProps, PdfRenderResult, PdfTemplate } from ${quote(options.runtimeImport)}`,
  ]

  ordered.forEach((template, index) => {
    lines.push(
      '',
      `type PdfComponent${index} = typeof import(${quote(importPath(template.filePath))})['default']`,
      `type PdfProps${index} = PdfComponentProps<PdfComponent${index}>`,
    )
  })

  lines.push('', 'export declare const pdf: {')

  ordered.forEach((template, index) => {
    lines.push(
      `  readonly ${quote(template.key)}: PdfTemplate<PdfProps${index}>`,
    )
  })

  lines.push('}', '')

  if (ordered.length === 0) {
    lines.push(
      'export declare function renderPdf(name: never, props: never): Promise<PdfRenderResult>',
      'export declare function getPdfTemplate(name: never): never',
    )
  }
  else {
    ordered.forEach((template, index) => {
      lines.push(
        `export declare function renderPdf(name: ${quote(template.key)}, props: PdfProps${index}): Promise<PdfRenderResult>`,
      )
    })

    lines.push(
      'export declare function renderPdf(name: string, props: Record<string, unknown>, escapeHatch: { readonly unsafe: true }): Promise<PdfRenderResult>',
    )

    lines.push('')

    ordered.forEach((template, index) => {
      lines.push(
        `export declare function getPdfTemplate(name: ${quote(template.key)}): PdfTemplate<PdfProps${index}>`,
      )
    })
  }

  lines.push(
    '',
    `export declare const pdfTemplateKeys: readonly [${ordered.map(template => quote(template.key)).join(', ')}]`,
    'export type PdfTemplateKey = typeof pdfTemplateKeys[number]',
    `export { NuxtPdfError, PDF_ERROR_CODES } from ${quote(options.runtimeImport)}`,
    `export type { PdfErrorCode } from ${quote(options.runtimeImport)}`,
    '',
  )

  return lines.join('\n')
}
