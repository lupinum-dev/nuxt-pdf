// The first render in a fresh Node process, from the built runtime in dist/
// and through the render worker: what a user's server pays once. Plain
// JavaScript, so Node loads it without a type stripper or resolve hook.
// test/performance.test.ts runs it and checks that its document has the byte
// length of `invoice` in workloads.ts, which it repeats.
import { performance } from 'node:perf_hooks'
import { defineComponent, h } from 'vue'

const runtime = new URL('../../../dist/runtime/', import.meta.url)
const { createPdfTemplate } = await import(new URL('server/registry.js', runtime).href)
const { PDF_COMPONENTS: { PdfDocument, PdfPage, PdfText } } = await import(new URL('components/index.js', runtime).href)
const { PDF_DEFINITION_PROPERTY } = await import(new URL('shared/template.js', runtime).href)

const invoice = Object.assign(defineComponent({
  name: 'PerformanceInvoice',
  props: { token: { required: true, type: String } },
  setup: props => () => h(PdfDocument, {}, {
    default: () => h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
      default: () => [
        h(PdfText, { style: { fontSize: 24, marginBottom: 16 } }, { default: () => `Invoice ${props.token}` }),
        ...Array.from({ length: 40 }, (_, index) =>
          h(PdfText, { style: { fontSize: 10, marginBottom: 3 } }, {
            default: () => `Line ${index + 1} — EUR ${(index + 1) * 12}.00`,
          })),
      ],
    }),
  }),
}), { [PDF_DEFINITION_PROPERTY]: { title: 'Performance invoice' } })

const template = createPdfTemplate('performance-invoice', invoice)
const start = performance.now()
const result = await template.render({ token: 'cold' })
process.stdout.write(JSON.stringify({ coldRenderMs: performance.now() - start, byteLength: result.diagnostics.byteLength }))
// The pool keeps its idle worker; the measurement is done.
process.exit(0)
