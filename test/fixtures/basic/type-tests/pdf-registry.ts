import { pdf, renderPdf } from '#pdf'

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
  result.diagnostics.warnings satisfies readonly string[]

  // @ts-expect-error Completed results deliberately expose no fake stream API.
  await result.toStream()
  // @ts-expect-error Diagnostics are immutable facts about the completed render.
  result.diagnostics.warnings.push('late mutation')
}

void verifyRenderResult

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
