import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import React from 'react'
import {
  Document as ReactDocument,
  Link as ReactLink,
  Page as ReactPage,
  Text as ReactText,
  View as ReactView,
  renderToBuffer as renderReactDocument,
} from '@react-pdf/renderer'
import type { DocumentNode } from '@react-pdf/layout'
import {
  PdfDocument,
  PdfLink,
  PdfPage,
  PdfText,
  PdfView,
} from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderDocument } from '../src/runtime/server/engine/render-document'
import { installPdfCanvasGlobals, parsePdf } from '../src/test/pdf'

// Paired React/Vue internal-link fixture. The link targets sit on small,
// non-splitting heading nodes so React PDF (whose named-destination table is
// last-writer-wins) and Vue (first-writer-wins) agree, letting React serve as
// the oracle for the LINK mechanics. Rendered single-pass on both sides — the
// targets' pages are fixed, so no page-number feedback is involved.
const TARGETS = ['alpha', 'beta'] as const

const rh = React.createElement

const createReactDoc = (): React.ReactElement => rh(
  ReactDocument,
  {},
  rh(
    ReactPage,
    { size: 'A4', style: { padding: 40 } },
    ...TARGETS.map(id => rh(ReactLink, { key: id, src: `#${id}`, style: { fontSize: 14, marginBottom: 8 } }, `Jump to ${id}`)),
  ),
  ...TARGETS.map(id => rh(
    ReactPage,
    { key: id, size: 'A4', style: { padding: 40 } },
    rh(ReactView, { id }, rh(ReactText, { style: { fontSize: 20 } }, `HEADING ${id}`)),
  )),
)

const VueDoc = defineComponent({
  name: 'InternalLinkDoc',
  setup() {
    return () =>
      h(PdfDocument, {}, {
        default: () => [
          h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
            default: () => TARGETS.map(id =>
              h(PdfLink, { src: `#${id}`, style: { fontSize: 14, marginBottom: 8 } }, { default: () => `Jump to ${id}` }),
            ),
          }),
          ...TARGETS.map(id =>
            h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
              default: () => h(PdfView, { id }, {
                default: () => h(PdfText, { style: { fontSize: 20 } }, { default: () => `HEADING ${id}` }),
              }),
            }),
          ),
        ],
      })
  },
})

const destinationPageNumbers = async (
  bytes: Uint8Array,
  ids: readonly string[] = TARGETS,
): Promise<Record<string, number>> => {
  installPdfCanvasGlobals()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 })
  const doc = await task.promise
  try {
    const pages: Record<string, number> = {}
    for (const id of ids) {
      const dest = await doc.getDestination(id) as [{ num: number, gen: number }] | null
      expect(dest, `named destination "${id}" missing from the PDF`).not.toBeNull()
      pages[id] = (await doc.getPageIndex(dest![0])) + 1
    }
    return pages
  }
  finally {
    await task.destroy()
  }
}

describe('internal links (paired React/Vue)', () => {
  it('emits matching link annotations and named destinations', async () => {
    const reactBytes = new Uint8Array(await renderReactDocument(
      createReactDoc() as Parameters<typeof renderReactDocument>[0],
    ))

    const mounted = await mountPdfComponent(VueDoc, {})
    let vueBytes: Uint8Array
    try {
      vueBytes = (await renderDocument(mounted.document as unknown as DocumentNode)).bytes
    }
    finally {
      mounted.unmount()
    }

    const [reactPdf, vuePdf] = await Promise.all([parsePdf(reactBytes), parsePdf(vueBytes)])

    const reactLinks = reactPdf.pages.flatMap(p => p.annotations).filter(a => a.subtype === 'Link')
    const vueLinks = vuePdf.pages.flatMap(p => p.annotations).filter(a => a.subtype === 'Link')

    // Both target the same named destinations by id.
    expect(vueLinks.map(a => a.destination).sort()).toEqual([...TARGETS])
    expect(vueLinks.map(a => a.destination).sort()).toEqual(reactLinks.map(a => a.destination).sort())

    // Both resolve those destinations to the same pages.
    const [reactDest, vueDest] = await Promise.all([
      destinationPageNumbers(reactBytes),
      destinationPageNumbers(vueBytes),
    ])
    expect(vueDest).toEqual(reactDest)
    expect(vueDest).toEqual({ alpha: 2, beta: 3 })
  }, 20_000)
})

// Vue-only destination anchoring on the SINGLE-pass path (the shipped path for
// link-only documents). React PDF cannot be the oracle here: its destination
// table is last-writer-wins, the exact behavior these tests reject.
describe('single-pass destination anchoring', () => {
  const renderVue = async (component: Parameters<typeof mountPdfComponent>[0]) => {
    const mounted = await mountPdfComponent(component, {})
    try {
      return (await renderDocument(mounted.document as unknown as DocumentNode)).bytes
    }
    finally {
      mounted.unmount()
    }
  }

  it('anchors a page-spanning id at its first page without multi-pass', async () => {
    const SpanningDoc = defineComponent({
      name: 'SpanningDoc',
      setup() {
        return () =>
          h(PdfDocument, {}, {
            default: () => [
              h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
                default: () => h(PdfLink, { src: '#long', style: { fontSize: 14 } }, { default: () => 'Jump to long' }),
              }),
              h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
                default: () => h(PdfView, { id: 'long' }, {
                  default: () => Array.from({ length: 80 }, (_, i) =>
                    h(PdfText, { style: { fontSize: 12, marginBottom: 4 } }, { default: () => `long line ${i + 1}` }),
                  ),
                }),
              }),
            ],
          })
      },
    })

    const bytes = await renderVue(SpanningDoc)
    const parsed = await parsePdf(bytes)
    const startPage = parsed.pages.find(p => p.text.includes('long line 1'))!.number
    const endPage = parsed.pages.find(p => p.text.includes('long line 80'))!.number
    expect(endPage).toBeGreaterThan(startPage)

    expect(await destinationPageNumbers(bytes, ['long'])).toEqual({ long: startPage })
  }, 20_000)

  it('keeps the destination of a fixed node repeated on every page', async () => {
    // Pagination reuses ONE node object (and props object) for a fixed node on
    // every page, so the anchoring pass must copy-on-write: an in-place delete
    // would erase the destination entirely.
    const FixedDoc = defineComponent({
      name: 'FixedDoc',
      setup() {
        return () =>
          h(PdfDocument, {}, {
            default: () => [
              h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
                default: () => [
                  h(PdfView, { id: 'brand', fixed: true, style: { position: 'absolute', top: 12, left: 40 } }, {
                    default: () => h(PdfText, { style: { fontSize: 9 } }, { default: () => 'Fieldnote Studio' }),
                  }),
                  h(PdfLink, { src: '#brand', style: { fontSize: 14, marginTop: 40 } }, { default: () => 'Jump to brand header' }),
                  ...Array.from({ length: 60 }, (_, i) =>
                    h(PdfText, { style: { fontSize: 12, marginBottom: 4 } }, { default: () => `body line ${i + 1}` }),
                  ),
                ],
              }),
            ],
          })
      },
    })

    const bytes = await renderVue(FixedDoc)
    const parsed = await parsePdf(bytes)
    expect(parsed.pageCount).toBeGreaterThan(1) // the fixed node repeats

    // The destination still exists and resolves to the first page.
    expect(await destinationPageNumbers(bytes, ['brand'])).toEqual({ brand: 1 })
  }, 20_000)

  it('rejects an unresolved internal destination before layout', async () => {
    const MissingDoc = defineComponent({
      name: 'MissingDoc',
      setup() {
        return () =>
          h(PdfDocument, {}, {
            default: () => h(PdfPage, { size: 'A4' }, {
              default: () => h(PdfLink, { src: '#missing' }, { default: () => 'Broken' }),
            }),
          })
      },
    })

    await expect(mountPdfComponent(MissingDoc, {})).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: '<PdfLink> internal destination does not match any id in the document.',
    })
  })
})
