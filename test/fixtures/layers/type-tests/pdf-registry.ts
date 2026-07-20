import { pdf, renderPdf } from '#pdf'

void pdf.invoice.render({ projectMessage: 'Typed project override' })
void renderPdf('invoice', { projectMessage: 'Typed project override' })

void pdf.certificate.render({ recipient: 'Typed base template' })
void renderPdf('certificate', { recipient: 'Typed base template' })

// @ts-expect-error The overridden base-layer props must not leak into #pdf.
void pdf.invoice.render({ baseMessage: 'Wrong layer' })
