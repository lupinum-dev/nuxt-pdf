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
