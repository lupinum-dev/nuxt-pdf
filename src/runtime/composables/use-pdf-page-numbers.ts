import {
  type InjectionKey,
  inject,
  readonly,
} from 'vue'
import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'

/**
 * A readonly, reactive map from a destination `id` to the 1-based page number it
 * finally resolves to. A value is `undefined` until the layout loop has located
 * the destination — on the FIRST layout pass every entry is `undefined`, so a
 * table-of-contents template must tolerate a missing number (render a blank or a
 * placeholder) rather than assume it exists.
 */
export type PdfPageNumbers = Readonly<Record<string, number | undefined>>

/**
 * The value `mountPdfComponent` provides so `usePdfPageNumbers` can read the live
 * page-number map and flag the render as multi-pass. Injecting it is the ONLY
 * signal that turns on the fixed-point layout loop; a document that never calls
 * the composable stays on the single-pass path (internal `#id` links resolve by
 * name in a single pass and do not need the loop).
 */
export interface PdfPageNumbersContext {
  /** The reactive backing map the render loop feeds each pass. */
  readonly pages: Record<string, number | undefined>
  /** Called at setup time to flag the mounted render as multi-pass. */
  markUsed(): void
}

export const PDF_PAGE_NUMBERS_KEY: InjectionKey<PdfPageNumbersContext>
  = Symbol.for('@lupinum/nuxt-pdf:page-numbers')

/**
 * Access the resolved page number of every destination `id` in the current PDF.
 * Auto-imported inside PDF templates and components. Calling it flags the render
 * as multi-pass: the engine lays the document out repeatedly, feeding each pass's
 * `id → page` map back through this composable until the numbers stabilize.
 *
 * ```ts
 * const pageNumbers = usePdfPageNumbers()
 * // in the template: {{ pageNumbers[section.id] ?? '' }}
 * ```
 *
 * Outside a PDF render there is nothing to resolve, and a silently empty map
 * would be indistinguishable from legitimate first-pass state, so calling it
 * anywhere but a PDF template's setup fails fast instead.
 */
export const usePdfPageNumbers = (): PdfPageNumbers => {
  const context = inject(PDF_PAGE_NUMBERS_KEY, null)

  if (!context) {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.TemplateInvalid,
      'usePdfPageNumbers() is only available inside a PDF template rendered by nuxt-pdf. '
      + 'Call it in the setup of a pdfs/*.vue template or a component it renders.',
    )
  }

  context.markUsed()
  return readonly(context.pages)
}
