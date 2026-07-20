import { Buffer } from 'node:buffer'
import type { RemoteAssetPolicy } from '../runtime/server/assets/remote'
import type { PdfTemplate } from './discover-templates'

export type PdfRegistryGenerationOptions = {
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
  runtimeImport: string
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
  const { remote } = options

  if (assets.length === 0 && fonts.length === 0 && !remote) return []

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

  lines.push('})')
  return lines
}

const orderedTemplates = (
  templates: readonly PdfTemplate[],
): PdfTemplate[] => {
  const result = [...templates].sort((left, right) =>
    compareText(left.canonicalKey, right.canonicalKey),
  )
  const canonicalKeys = new Map<string, PdfTemplate>()
  const propertyKeys = new Map<string, PdfTemplate>()

  for (const template of result) {
    const canonicalDuplicate = canonicalKeys.get(template.canonicalKey)
    if (canonicalDuplicate) {
      throw new TypeError(
        `Cannot generate duplicate PDF template key "${template.canonicalKey}" from "${canonicalDuplicate.filePath}" and "${template.filePath}".`,
      )
    }

    const propertyDuplicate = propertyKeys.get(template.propertyKey)
    if (propertyDuplicate) {
      throw new TypeError(
        `Cannot generate duplicate PDF property "${template.propertyKey}" for "${propertyDuplicate.canonicalKey}" and "${template.canonicalKey}".`,
      )
    }

    canonicalKeys.set(template.canonicalKey, template)
    propertyKeys.set(template.propertyKey, template)
  }

  return result
}

const validateOptions = (options: PdfRegistryGenerationOptions) => {
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
  const lines = [
    `import { createPdfRegistry, createPdfTemplate } from ${quote(options.runtimeImport)}`,
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
    const runtimeSpread = runtimeOptions.length > 0
      ? ', ...__pdfRuntimeOptions'
      : ''
    const templateOptions = `{ file: ${quote(`pdfs/${template.relativePath}`)}${runtimeSpread} }`
    lines.push(
      `  ${quote(template.propertyKey)}: createPdfTemplate(${quote(template.canonicalKey)}, __pdfTemplate${index}, ${templateOptions}),`,
    )
  })

  lines.push(
    '})',
    '',
    'export const pdf = registry.pdf',
    'export const renderPdf = registry.renderPdf',
    'export const getPdfTemplate = registry.getPdfTemplate',
    'export const pdfTemplateKeys = registry.pdfTemplateKeys',
    '',
  )

  return lines.join('\n')
}

export const generatePdfRegistryTypes = (
  templates: readonly PdfTemplate[],
  options: PdfRegistryGenerationOptions,
): string => {
  validateOptions(options)
  const ordered = orderedTemplates(templates)
  const lines = [
    `import type { PdfRenderResult, PdfTemplate } from ${quote(options.runtimeImport)}`,
  ]

  ordered.forEach((template, index) => {
    lines.push(
      '',
      `type PdfComponent${index} = typeof import(${quote(importPath(template.filePath))})['default']`,
      `type PdfProps${index} = InstanceType<PdfComponent${index}>['$props']`,
    )
  })

  lines.push('', 'export declare const pdf: {')

  ordered.forEach((template, index) => {
    lines.push(
      `  readonly ${quote(template.propertyKey)}: PdfTemplate<PdfProps${index}>`,
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
        `export declare function renderPdf(name: ${quote(template.canonicalKey)}, props: PdfProps${index}): Promise<PdfRenderResult>`,
      )
    })

    lines.push(
      'export declare function renderPdf(name: string, props: Record<string, unknown>, escapeHatch: { readonly unsafe: true }): Promise<PdfRenderResult>',
    )

    lines.push('')

    ordered.forEach((template, index) => {
      lines.push(
        `export declare function getPdfTemplate(name: ${quote(template.canonicalKey)}): PdfTemplate<PdfProps${index}>`,
      )
    })
  }

  lines.push(
    '',
    `export declare const pdfTemplateKeys: readonly [${ordered.map(template => quote(template.canonicalKey)).join(', ')}]`,
    'export type PdfTemplateKey = typeof pdfTemplateKeys[number]',
    '',
  )

  return lines.join('\n')
}
