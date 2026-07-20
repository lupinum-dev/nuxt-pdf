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
import { installPdfCanvasGlobals, parsePdf } from './utils/pdf'

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
): Promise<Record<string, number>> => {
  installPdfCanvasGlobals()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 }).promise
  try {
    const pages: Record<string, number> = {}
    for (const id of TARGETS) {
      const dest = await doc.getDestination(id) as [{ num: number, gen: number }]
      pages[id] = (await doc.getPageIndex(dest[0])) + 1
    }
    return pages
  }
  finally {
    await doc.destroy()
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
