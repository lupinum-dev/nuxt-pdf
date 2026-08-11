import type { PdfDefinition } from './shared/template'

/**
 * Type and runtime fallback for the `definePdf` compiler macro.
 * Discovered PDF templates erase this call before execution.
 */
export function definePdf<Props extends object = Record<string, unknown>>(
  _definition: PdfDefinition<Props>,
): void {
  throw new Error(
    'definePdf() is a compiler macro that only works as a top-level call in '
    + 'a discovered pdfs/*.vue template.',
  )
}
