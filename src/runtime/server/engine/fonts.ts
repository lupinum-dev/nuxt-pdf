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
  /^data:font\/(?:otf|ttf|woff2);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)

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

const sameFontList = (
  left: readonly BundledPdfFontDescriptor[],
  right: readonly BundledPdfFontDescriptor[],
): boolean =>
  left.length === right.length
  && left.every((font, index) => {
    const other = right[index]!
    return font.family === other.family
      && font.src === other.src
      && font.fontStyle === other.fontStyle
      && font.fontWeight === other.fontWeight
  })

// Font declarations are immutable build artifacts (validated data URLs baked
// into the generated registry), so the parsed-font cache inside one FontStore
// holds no render data and can be shared across renders. Re-parsing every TTF
// per render is pure CPU waste on hot paths. One cached store keyed by the
// exact descriptor list keeps behavior identical when the list changes.
let sharedFontStore:
  | { fonts: readonly BundledPdfFontDescriptor[], store: PdfFontStore }
  | undefined

export const getSharedPdfFontStore = (
  fonts: readonly BundledPdfFontDescriptor[] = [],
): PdfFontStore => {
  if (sharedFontStore && sameFontList(sharedFontStore.fonts, fonts)) {
    return sharedFontStore.store
  }

  const store = createPdfFontStore(fonts)
  sharedFontStore = { fonts, store }
  return store
}
