import type { PdfSourcePosition } from './errors'

/**
 * Development only. When a `.vue` file in `pdfs/` fails to compile, the build
 * plugin emits a stub component instead of failing the Nitro build. The stub
 * and the `Error` its `setup()` throws carry this property, so the registry
 * and the preview can show the compiler message and position.
 */
export const PDF_COMPILE_ERROR_PROPERTY = '__nuxtPdfCompileError' as const

export interface PdfCompileErrorInfo {
  /** The compiler message, without the file path. */
  readonly message: string
  /** Path relative to the project root, 1-based line and column. */
  readonly source: PdfSourcePosition
}

/**
 * Development only. A compiled template carries the position of its
 * `definePdf` call here, so a metadata value that fails validation when the
 * registry loads is shown at that position like a compile error.
 */
export const PDF_DEFINITION_SOURCE_PROPERTY = '__nuxtPdfDefinitionSource' as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  (typeof value === 'object' || typeof value === 'function') && value !== null

/** The compile error a stub component or its thrown `Error` carries, if any. */
export const pdfCompileErrorOf = (value: unknown): PdfCompileErrorInfo | undefined => {
  if (!isRecord(value)) return undefined
  const info = value[PDF_COMPILE_ERROR_PROPERTY]
  if (!isRecord(info) || typeof info.message !== 'string') return undefined
  const source = sourcePositionOf(info.source)
  return source && { message: info.message, source }
}

/** The `definePdf` position a development build put on a template component. */
export const pdfDefinitionSourceOf = (component: unknown): PdfSourcePosition | undefined =>
  isRecord(component) ? sourcePositionOf(component[PDF_DEFINITION_SOURCE_PROPERTY]) : undefined

const sourcePositionOf = (value: unknown): PdfSourcePosition | undefined => {
  if (!isRecord(value)) return undefined
  const { file, line, column } = value
  if (typeof file !== 'string' || typeof line !== 'number' || typeof column !== 'number') return undefined
  return { file, line, column }
}
