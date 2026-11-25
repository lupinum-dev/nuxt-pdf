import { Buffer } from 'node:buffer'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import type { DocumentNode } from '../src/runtime/server/engine/layout/index'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderDocument } from './engine-render'
import { installPdfCanvasGlobals, parsePdf } from '../src/test/pdf'
import { renderPreparedPdfTemplate } from '../src/test/render-template'

const { PdfDocument, PdfLink, PdfPage, PdfText, PdfView } = PDF_COMPONENTS

// Internal links: the targets sit on small, non-splitting heading nodes on
// pages of their own, so each destination page is fixed.
const TARGETS = ['alpha', 'beta'] as const

const VueDoc = defineComponent({
  name: 'InternalLinkDoc',
  setup() {
    return () =>
      h(PdfDocument, {}, {
        default: () => [
          h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
            default: () => TARGETS.map(id =>
              h(PdfLink, { href: `#${id}`, style: { fontSize: 14, marginBottom: 8 } }, { default: () => `Jump to ${id}` }),
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

describe('internal links', () => {
  it('emits link annotations to named destinations on their pages', async () => {
    const mounted = await mountPdfComponent(VueDoc, {})
    let vueBytes: Uint8Array
    try {
      vueBytes = (await renderDocument(mounted.document as unknown as DocumentNode)).bytes
    }
    finally {
      mounted.unmount()
    }

    const vuePdf = await parsePdf(vueBytes)
    const vueLinks = vuePdf.pages.flatMap(p => p.annotations).filter(a => a.subtype === 'Link')

    expect(vueLinks.map(a => a.destination).sort()).toEqual([...TARGETS])
    expect(await destinationPageNumbers(vueBytes)).toEqual({ alpha: 2, beta: 3 })
  }, 20_000)
})

// Destination anchoring. The page-spanning case is in
// test/page-primitives.test.ts, the unresolved destination in
// test/renderer.test.ts.
describe('destination anchoring', () => {
  const renderVue = async (component: Parameters<typeof mountPdfComponent>[0]) => {
    const mounted = await mountPdfComponent(component, {})
    try {
      return (await renderDocument(mounted.document as unknown as DocumentNode)).bytes
    }
    finally {
      mounted.unmount()
    }
  }

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
                  h(PdfLink, { href: '#brand', style: { fontSize: 14, marginTop: 40 } }, { default: () => 'Jump to brand header' }),
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
  // Catches a link to a nested text that leads nowhere (no destination), or
  // to the last line of a nested text that wraps instead of its first.
  it('places the destination of a nested text at the top of its first line', async () => {
    const bytes = await renderVue(defineComponent(() => () => h(PdfDocument, {}, () => [
      h(PdfPage, { size: [300, 200], style: { padding: 20, fontSize: 10, fontFamily: 'Helvetica' } }, () => [
        h(PdfLink, { href: '#claim' }, () => 'To the claim'),
        h(PdfText, () => ['Peat covers three percent of the land. ', h(PdfText, { id: 'claim' }, () => 'It stores more carbon than all the forests of the world together, year after year.')]),
      ]),
    ])))
    installPdfCanvasGlobals()
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 })
    const doc = await task.promise
    try {
      const destination = await doc.getDestination('claim') as [{ num: number, gen: number }, unknown, unknown, number] | null
      // From the page top: the paragraph's first line, under the 11 pt line of the link.
      expect(destination === null ? 'missing' : 200 - destination[3]).toBe(31)
    }
    finally {
      await task.destroy()
    }
  }, 20_000)
})

// Readers find a named destination by a binary search over the sorted keys
// (ISO 32000-1, 7.9.6). pdfkit sorted them with `localeCompare`, which puts
// "alpha" before "Bravo" where the bytes put it after, and gave the root
// `Limits`, which only an intermediate node has.
describe('the destination name tree', () => {
  it('sorts the names by their bytes, without Limits on the root', async () => {
    const ids = ['zulu', 'Bravo', 'alpha', 'a1', 'Alpha', '_under', 'a-b', 'Zulu']
    const { bytes } = await renderPreparedPdfTemplate(defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, { size: 'A6' }, () => [
        ...ids.map(id => h(PdfLink, { href: `#${id}` }, () => `to ${id}`)),
        ...ids.map(id => h(PdfText, { id }, () => id)),
      ]))), {})

    const tree = /\/Dests <<\n\/Names \[(.*?)\]\n>>/s.exec(Buffer.from(bytes).toString('latin1'))
    expect(tree).not.toBeNull()
    expect([...tree![1]!.matchAll(/\(([^)]*)\)/g)].map(match => match[1])).toEqual([...ids].sort())
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('/Limits')
    expect(await destinationPageNumbers(bytes, ids)).toEqual(Object.fromEntries(ids.map(id => [id, 1])))
  })
})
