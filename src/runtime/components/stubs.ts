import { defineComponent } from 'vue'
import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'

/**
 * Development-only guards for the global `Pdf*` component names. Types declare
 * these names globally so `pdfs/*.vue` templates typecheck, which means an
 * accidental `<PdfText>` inside an ordinary app component also typechecks —
 * while resolving to nothing at runtime. Registering these stubs turns that
 * silent failure into an immediate, actionable error.
 */
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

export const PdfCircle = createPdfStub('PdfCircle')
export const PdfClipPath = createPdfStub('PdfClipPath')
export const PdfDefs = createPdfStub('PdfDefs')
export const PdfDocument = createPdfStub('PdfDocument')
export const PdfEllipse = createPdfStub('PdfEllipse')
export const PdfG = createPdfStub('PdfG')
export const PdfImage = createPdfStub('PdfImage')
export const PdfLine = createPdfStub('PdfLine')
export const PdfLinearGradient = createPdfStub('PdfLinearGradient')
export const PdfLink = createPdfStub('PdfLink')
export const PdfNote = createPdfStub('PdfNote')
export const PdfPage = createPdfStub('PdfPage')
export const PdfPath = createPdfStub('PdfPath')
export const PdfPolygon = createPdfStub('PdfPolygon')
export const PdfPolyline = createPdfStub('PdfPolyline')
export const PdfRadialGradient = createPdfStub('PdfRadialGradient')
export const PdfRect = createPdfStub('PdfRect')
export const PdfStop = createPdfStub('PdfStop')
export const PdfSvg = createPdfStub('PdfSvg')
export const PdfText = createPdfStub('PdfText')
export const PdfTspan = createPdfStub('PdfTspan')
export const PdfView = createPdfStub('PdfView')
