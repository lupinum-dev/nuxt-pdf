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

export const createPdfStub = (name: string) => defineComponent({
  name,
  setup() {
    throw new NuxtPdfError(PDF_ERROR_CODES.TemplateInvalid, stubMessage(name))
  },
  render: () => null,
})
