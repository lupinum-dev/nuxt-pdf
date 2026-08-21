import { describe, expect, it } from 'vitest'
import { createPdfStubs, PDF_STUB_NAMES } from '../src/runtime/components/stubs'
import { NuxtPdfError } from '../src/runtime/shared/errors'

describe('development-only Pdf* stubs', () => {
  it('covers every globally typed Pdf* component name', () => {
    // Must stay in sync with the GlobalComponents augmentation in
    // src/module.ts and the primitives registered inside pdfs/ templates.
    expect([...PDF_STUB_NAMES].sort()).toEqual([
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
    ])
  })

  it.each([...PDF_STUB_NAMES])('fails %s setup with an actionable error', (name) => {
    const stubs = createPdfStubs()
    const stub = stubs[name]!

    expect(stub.name).toBe(name)
    expect(() => (stub.setup as () => void).call({})).toThrow(NuxtPdfError)
    expect(() => (stub.setup as () => void).call({})).toThrow(
      new RegExp(`<${name}> only works inside a discovered pdfs/`),
    )
  })
})
