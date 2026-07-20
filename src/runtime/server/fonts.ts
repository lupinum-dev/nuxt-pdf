import FontStore from '@react-pdf/font'

export type PdfFontStyle = 'italic' | 'normal' | 'oblique'

export type PdfFontWeightName
  = | 'black'
    | 'bold'
    | 'demibold'
    | 'extrabold'
    | 'extralight'
    | 'hairline'
    | 'heavy'
    | 'light'
    | 'medium'
    | 'normal'
    | 'semibold'
    | 'thin'
    | 'ultrabold'
    | 'ultralight'

export type PdfFontWeight = number | PdfFontWeightName

export interface PdfFontDeclaration {
  family: string
  src: string
  fontStyle?: PdfFontStyle
  fontWeight?: PdfFontWeight
}

export type PdfFontDataUrl
  = `data:font/${'otf' | 'ttf'};base64,${string}`

export interface BundledPdfFontDescriptor {
  family: string
  src: PdfFontDataUrl
  fontStyle?: PdfFontStyle
  fontWeight?: number
}

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
