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
