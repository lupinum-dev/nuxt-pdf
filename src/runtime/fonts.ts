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
  = `data:font/${'otf' | 'ttf' | 'woff2'};base64,${string}`

export interface BundledPdfFontDescriptor {
  family: string
  src: PdfFontDataUrl
  fontStyle?: PdfFontStyle
  fontWeight?: number
}
