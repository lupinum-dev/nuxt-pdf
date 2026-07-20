import {
  type InjectionKey,
  inject,
  reactive,
  readonly,
} from 'vue'

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
 * page-number map and flag the render as multi-pass. Injecting it is the signal
 * that turns on the fixed-point layout loop; a document that never calls the
 * composable (and has no internal `#id` link) stays on the single-pass path.
 */
export interface PdfPageNumbersContext {
  /** The reactive backing map the render loop feeds each pass. */
  readonly pages: Record<string, number | undefined>
  /** Called at setup time to flag the mounted render as multi-pass. */
  markUsed(): void
}

export const PDF_PAGE_NUMBERS_KEY: InjectionKey<PdfPageNumbersContext>
  = Symbol('nuxt-pdf:page-numbers')

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
 * Outside a PDF render there is nothing to resolve, so the composable returns a
 * stable empty map instead of throwing.
 */
export const usePdfPageNumbers = (): PdfPageNumbers => {
  const context = inject(PDF_PAGE_NUMBERS_KEY, null)

  if (!context) return readonly(reactive<Record<string, number | undefined>>({}))

  context.markUsed()
  return readonly(context.pages)
}
