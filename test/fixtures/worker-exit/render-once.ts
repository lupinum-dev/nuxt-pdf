// Renders one PDF in a pool worker and returns. The process must then exit on
// its own: an idle pool worker must not keep it alive (test/worker-render.test.ts).
import { defineComponent, h } from 'vue'
import { PDF_COMPONENTS } from '../../../src/runtime/components'
import { createPdfTemplate } from '../../../src/runtime/server/registry'
import { pdfWorkerPoolState } from '../../../src/runtime/server/worker-render'
import { PDF_DEFINITION_PROPERTY } from '../../../src/runtime/shared/template'

const { PdfDocument, PdfPage, PdfText } = PDF_COMPONENTS

const Hello = Object.assign(defineComponent(() => () => h(PdfDocument, null, () =>
  h(PdfPage, null, () => h(PdfText, null, () => 'Hello')))), { [PDF_DEFINITION_PROPERTY]: {} })

const result = await createPdfTemplate('hello', Hello).render({})
process.stdout.write(JSON.stringify({ pages: result.diagnostics.pageCount, ...pdfWorkerPoolState() }))
