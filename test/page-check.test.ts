// The page builder is the only pagination: a page it places wrong is a bug in
// the builder, and the render must fail with a typed error that says so, in
// production too, never print the page wrong. Each test injects one fault.
import { defineComponent, h } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'

let fault: 'lower first node' | 'larger room' | undefined

afterEach(() => {
  fault = undefined
})

// The layout of each page (the check) puts its first node 2 pt lower.
vi.mock('../src/runtime/server/engine/layout/text/layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/runtime/server/engine/layout/text/layout')>()
  return {
    ...actual,
    resolvePageTextLayout: ((page, fontStore) => {
      const laidOut = actual.resolvePageTextLayout(page, fontStore)
      const [first, ...rest] = laidOut.children ?? []
      if (fault !== 'lower first node' || first?.box?.top === undefined) return laidOut
      return { ...laidOut, children: [{ ...first, box: { ...first.box, top: first.box.top + 2 } }, ...rest] }
    }) satisfies typeof actual.resolvePageTextLayout,
  }
})

// The builder fills each page as if it had 11 pt (one line) more room.
vi.mock('../src/runtime/server/engine/layout/paginate/rules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/runtime/server/engine/layout/paginate/rules')>()
  return { ...actual, wrapAreaOf: (page => actual.wrapAreaOf(page) + (fault === 'larger room' ? 11 : 0)) satisfies typeof actual.wrapAreaOf }
})

const { PdfDocument, PdfPage, PdfText, PdfView } = PDF_COMPONENTS

const rejection = async (children: () => ReturnType<typeof h>[]) => {
  const document = defineComponent(() => () => h(PdfDocument, null, () =>
    h(PdfPage, { size: 'A6', style: { padding: 20, fontSize: 10 } }, children)))
  const mounted = await mountPdfComponent(document)
  try {
    return await renderPlainDocument(mounted.document).then(() => undefined, (error: unknown) => error)
  }
  finally {
    mounted.unmount()
  }
}

it('fails a page whose layout differs from the builder\'s sums with PDF_RENDER_ERROR', async () => {
  fault = 'lower first node'
  expect(await rejection(() => Array.from({ length: 40 }, (_, index) => h(PdfText, null, () => `Line ${index + 1}`)))).toMatchObject({
    code: 'PDF_RENDER_ERROR',
    message: expect.stringMatching(/^Page builder: the layout of page 1 differs from the builder's sums by 2(\.\d+)? pt\. This is a bug in Nuxt PDF/),
  })
})

// The page check misses this squeeze: the last view is placed whole, so the
// sums hold no tops for its lines, and yoga squeezed them to 8.2 pt each
// inside the page (the render passed, the lines overlapped).
it('fails a page whose flow ends below its content area with PDF_RENDER_ERROR', async () => {
  fault = 'larger room'
  expect(await rejection(() => [
    h(PdfView, { style: { height: 355, flexShrink: 0 } }, () => [h(PdfText, null, () => 'Block')]),
    h(PdfView, null, () => [1, 2, 3].map(line => h(PdfText, null, () => `Line ${line}`))),
  ])).toMatchObject({
    code: 'PDF_RENDER_ERROR',
    message: expect.stringMatching(/^Page builder: page 1 cannot be painted: its flow ends 8\.47\d* pt below its content area\. This is a bug in Nuxt PDF/),
  })
})
