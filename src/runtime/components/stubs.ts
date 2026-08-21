import { defineComponent } from 'vue'
import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'

/**
 * Development-only guards for the global `Pdf*` component names. Types declare
 * these names globally so `pdfs/*.vue` templates typecheck, which means an
 * accidental `<PdfText>` inside an ordinary app component also typechecks —
 * while resolving to nothing at runtime. Registering these stubs turns that
 * silent failure into an immediate, actionable error.
 */
export const PDF_STUB_NAMES = [
  'PdfCircle',
  'PdfClipPath',
  'PdfDefs',
  'PdfDocument',
  'PdfEllipse',
  'PdfG',
  'PdfImage',
  'PdfLine',
  'PdfLinearGradient',
  'PdfLink',
  'PdfNote',
  'PdfPage',
  'PdfPath',
  'PdfPolygon',
  'PdfPolyline',
  'PdfRadialGradient',
  'PdfRect',
  'PdfStop',
  'PdfSvg',
  'PdfText',
  'PdfTspan',
  'PdfView',
] as const

const stubMessage = (name: string): string =>
  `<${name}> only works inside a discovered pdfs/*.vue template rendered by `
  + '@lupinum/nuxt-pdf. Move this component under pdfs/, or replace it with '
  + 'ordinary Vue/HTML components.'

const createPdfStub = (name: string) => defineComponent({
  name,
  setup() {
    throw new NuxtPdfError(PDF_ERROR_CODES.TemplateInvalid, stubMessage(name))
  },
  render: () => null,
})

export const createPdfStubs = (): Record<string, ReturnType<typeof defineComponent>> =>
  Object.fromEntries(
    PDF_STUB_NAMES.map(name => [name, createPdfStub(name)]),
  )
