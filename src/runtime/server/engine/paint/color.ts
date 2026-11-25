import { readPdfColor, type PdfColor } from '../../../shared/color'

// The painter reads every colour with the one colour rule (shared/color.ts),
// which validation uses too. Colours arrive as written: the style step passes
// them through, so an alpha stays exact.

const BLACK: PdfColor = { rgb: [0, 0, 0], alpha: 1 }

/** A colour, or opaque black for a missing one; validation lets no unreadable colour through. */
export const paintColor = (value: string | undefined): PdfColor =>
  (value ? readPdfColor(value) : undefined) ?? BLACK
