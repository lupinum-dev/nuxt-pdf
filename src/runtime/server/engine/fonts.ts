import FontStore from '@react-pdf/font'
import type {
  BundledPdfFontDescriptor,
  PdfFontDataUrl,
} from '../../fonts'

declare const pdfFontStoreBrand: unique symbol

/** Opaque server-only font store accepted by the PDF engine. */
export type PdfFontStore = {
  readonly [pdfFontStoreBrand]: true
}

const isBundledFontSource = (src: string): src is PdfFontDataUrl =>
  /^data:font\/(?:otf|ttf);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)

export const createPdfFontStore = (
  fonts: readonly BundledPdfFontDescriptor[] = [],
): PdfFontStore => {
  const fontStore = new FontStore()

  for (const font of fonts) {
    if (!isBundledFontSource(font.src)) {
      throw new TypeError(
        `PDF font "${font.family}" must use a validated embedded font source.`,
      )
    }

    fontStore.register({
      family: font.family,
      src: font.src,
      fontStyle: font.fontStyle,
      fontWeight: font.fontWeight,
    })
  }

  return fontStore as unknown as PdfFontStore
}
