// @ts-expect-error Preview fixtures are not part of the public registry module.
import { pdf, pdfPreview, renderPdf } from '#pdf'

void pdfPreview

const lines = [{
  description: 'Typed line',
  id: 'typed',
  price: 'EUR 10.00',
}]

void pdf.invoice.render({
  customer: 'Ada',
  lines,
  number: 'INV-TYPED',
})

void pdf.invoice.render({
  customer: 'Ada',
  lines,
  number: 'INV-TYPED',
  // @ts-expect-error Vue vnode props are not part of a PDF template's authored API.
  class: 'not-a-template-prop',
})

void pdf.invoice.render({
  customer: 'Ada',
  lines,
  number: 'INV-TYPED',
  // @ts-expect-error Vue lifecycle vnode hooks are renderer internals, not template props.
  onVnodeMounted: () => {},
})

void renderPdf('invoice', {
  customer: 'Ada',
  lines,
  number: 'INV-TYPED',
})

async function verifyRenderResult() {
  const result = await pdf.invoice.render({
    customer: 'Ada',
    lines,
    number: 'INV-TYPED',
  })

  result.diagnostics.byteLength satisfies number
  result.diagnostics.layoutWarnings satisfies readonly ({
    readonly availableHeight: number
    readonly code: 'PDF_UNBREAKABLE_NODE_OVERFLOW'
    readonly nodeHeight: number
    readonly nodeType: 'PdfCheckbox' | 'PdfImage' | 'PdfLink' | 'PdfNote' | 'PdfRadio' | 'PdfSelect' | 'PdfSvg' | 'PdfText' | 'PdfTextField' | 'PdfView'
    readonly pageNumber: number
  } | {
    readonly code: 'PDF_CONTENT_HIDDEN'
    readonly hiddenLines: number
    readonly hiddenNodes: number
    readonly nodeType: 'PdfCheckbox' | 'PdfImage' | 'PdfLink' | 'PdfNote' | 'PdfRadio' | 'PdfSelect' | 'PdfSvg' | 'PdfText' | 'PdfTextField' | 'PdfView'
    readonly pageNumber: number
    readonly source?: { readonly file: string, readonly line: number, readonly column: number }
  } | {
    readonly code: 'PDF_TABLE_COLUMNS_TOO_NARROW'
    readonly neededWidth: number
    readonly pageNumber: number
    readonly tableWidth: number
  } | {
    readonly code: 'PDF_FOOTNOTES_MOVED'
    readonly footnotes: readonly number[]
    readonly pageNumber: number
  } | {
    readonly code: 'PDF_GLYPH_MISSING'
    readonly codePoint: number
    readonly fontFamily: string
    readonly pageNumber: number
    readonly source?: { readonly file: string, readonly line: number, readonly column: number }
  } | {
    readonly code: 'PDF_HYPHENATION_UNAVAILABLE'
    readonly language: string
  } | {
    readonly code: 'PDF_KEEP_IGNORED'
    readonly nodeType: 'PdfCheckbox' | 'PdfImage' | 'PdfLink' | 'PdfNote' | 'PdfRadio' | 'PdfSelect' | 'PdfSvg' | 'PdfText' | 'PdfTextField' | 'PdfView'
    readonly pageNumber: number
    readonly source?: { readonly file: string, readonly line: number, readonly column: number }
  })[]
  for (const warning of result.diagnostics.layoutWarnings) {
    // The fields of a code are read after checking it.
    if (warning.code === 'PDF_TABLE_COLUMNS_TOO_NARROW') warning.neededWidth satisfies number
    else if (warning.code === 'PDF_FOOTNOTES_MOVED') warning.footnotes satisfies readonly number[]
    else if (warning.code === 'PDF_GLYPH_MISSING') warning.codePoint satisfies number
    else if (warning.code === 'PDF_HYPHENATION_UNAVAILABLE') warning.language satisfies string
    else if (warning.code === 'PDF_CONTENT_HIDDEN') warning.hiddenLines satisfies number
    else if (warning.code === 'PDF_KEEP_IGNORED') warning.pageNumber satisfies number
    else warning.nodeHeight satisfies number
    // @ts-expect-error a field of one code is not on the union
    void warning.nodeHeight
  }
  result.diagnostics.registeredFontFaces satisfies readonly {
    readonly family: string
    readonly fontStyle?: string
    readonly fontWeight?: number
  }[]
  result.metadata.title satisfies string | undefined

  // @ts-expect-error Completed results deliberately expose no fake stream API.
  await result.toStream()
  // @ts-expect-error Diagnostics are immutable facts about the completed render.
  result.diagnostics.byteLength = 0
  // @ts-expect-error Resolved render metadata is immutable.
  result.metadata.title = 'late mutation'
}

void verifyRenderResult

// @ts-expect-error Preview definition details are internal development data.
void pdf.invoice.definition
// @ts-expect-error Preview sample data is not a public template member.
void pdf.invoice.sampleData
// @ts-expect-error Preview scenarios are not a public template member.
void pdf.invoice.scenarios
// @ts-expect-error Preview scenario names are not a public template member.
void pdf.invoice.scenarioNames

declare const dynamicName: string
declare const dynamicProps: Record<string, unknown>

void renderPdf(dynamicName, dynamicProps, { unsafe: true })

// @ts-expect-error Dynamic names require the explicit unknown-props escape hatch.
void renderPdf(dynamicName, dynamicProps)

// @ts-expect-error Required template props remain required.
void pdf.invoice.render({ customer: 'Ada' })

void pdf.invoice.render({
  customer: 'Ada',
  lines,
  number: 'INV-TYPED',
  // @ts-expect-error Unknown props do not weaken the generated registry.
  unexpected: true,
})

// @ts-expect-error Canonical render names are a closed union.
void renderPdf('missing', {})
