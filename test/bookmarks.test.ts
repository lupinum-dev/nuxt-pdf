import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import type { DocumentNode } from '../src/runtime/server/engine/layout/index'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderDocument } from './engine-render'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { getPdfOutline, type PdfOutlineItem } from '../src/test/pdf'
import { renderPreparedPdfTemplate } from '../src/test/render-template'

const { PdfDocument, PdfImage, PdfPage, PdfText, PdfView } = PDF_COMPONENTS

// The outline the bookmark document must produce.
interface SectionSpec { title: string, detail: string, expanded: boolean }
interface ChapterSpec { title: string, expanded: boolean, sections: SectionSpec[] }
const CHAPTERS: ChapterSpec[] = [
  {
    title: 'Chapter 1',
    expanded: true,
    sections: [
      { title: 'Section 1.1', detail: 'Detail 1.1', expanded: true },
      { title: 'Section 1.2', detail: 'Detail 1.2', expanded: false },
    ],
  },
  {
    title: 'Chapter 2',
    expanded: false,
    sections: [{ title: 'Section 2.1', detail: 'Detail 2.1', expanded: true }],
  },
]

const expectedOutline: PdfOutlineItem[] = CHAPTERS.map(chapter => ({
  title: chapter.title,
  expanded: chapter.expanded,
  children: chapter.sections.map(section => ({
    title: section.title,
    expanded: section.expanded,
    children: [{ title: section.detail, children: [] }],
  })),
}))

const VueBookmarkDocument = defineComponent({
  name: 'VueBookmarkDocument',
  setup() {
    return () =>
      h(PdfDocument, {}, {
        default: () => CHAPTERS.map((chapter, chapterIndex) =>
          h(PdfPage, { size: 'A4', break: chapterIndex > 0, bookmark: { title: chapter.title, expanded: chapter.expanded }, style: { padding: 40 } }, {
            default: () => chapter.sections.map(section =>
              h(PdfView, { bookmark: { title: section.title, expanded: section.expanded } }, {
                default: () => [
                  h(PdfText, { style: { fontSize: 16 } }, { default: () => section.title }),
                  h(PdfText, { bookmark: section.detail, style: { fontSize: 11 } }, { default: () => section.detail }),
                ],
              }),
            ),
          }),
        ),
      })
  },
})

describe('bookmarks (outline)', () => {
  it('builds the outline tree from nested bookmarks', async () => {
    const mounted = await mountPdfComponent(VueBookmarkDocument, {})
    let vueOutline: PdfOutlineItem[]
    try {
      const vue = await renderDocument(mounted.document as unknown as DocumentNode)
      vueOutline = await getPdfOutline(vue.bytes)
    }
    finally {
      mounted.unmount()
    }

    expect(vueOutline).toEqual(expectedOutline)
  }, 20_000)

  it('emits a bookmark carried by an image', async () => {
    const imagePath = fileURLToPath(new URL('./fixtures/assets/sample.png', import.meta.url))
    const title = 'Image appendix'
    const VueImageBookmarkDocument = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, { size: 'A4' }, {
          // The admitted bytes: renderPdf resolves every source before layout.
          default: () => h(PdfImage, {
            bookmark: title,
            src: readFileSync(imagePath),
            style: { width: 32, height: 32 },
          }),
        }),
      }))

    const mounted = await mountPdfComponent(VueImageBookmarkDocument)

    try {
      const vue = await renderDocument(mounted.document as unknown as DocumentNode)
      const expected = [{ title, children: [] }]

      expect(await getPdfOutline(vue.bytes)).toEqual(expected)
    }
    finally {
      mounted.unmount()
    }
  }, 20_000)

  // pdfkit wrote `page width - left` as an entry's left edge, and an open
  // entry counted only its direct children (ISO 32000-1, 12.3.3: every
  // descendant a reader shows when it opens).
  it('writes each entry\'s left edge and the count of the entries it shows', async () => {
    const leaf = (title: string) => h(PdfText, { bookmark: title }, () => title)
    const { bytes } = await renderPreparedPdfTemplate(defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, { size: 'A5', style: { padding: 24 } }, () => [
        h(PdfView, { bookmark: { title: 'Closed', expanded: false } }, () => [
          leaf('Inside closed'),
          h(PdfView, { bookmark: { title: 'Open inside closed', expanded: true } }, () => [leaf('Deep')]),
        ]),
        h(PdfView, { bookmark: { title: 'Open', expanded: true }, style: { marginLeft: 40 } }, () => [
          h(PdfView, { bookmark: { title: 'Open inside open', expanded: true } }, () => [leaf('Leaf')]),
          h(PdfView, { bookmark: { title: 'Closed inside open', expanded: false } }, () => [leaf('Hidden')]),
        ]),
      ]))), {})

    interface Entry { title: string, count?: number, dest: unknown, items: Entry[] }
    const task = getDocument({ data: Uint8Array.from(bytes), verbosity: 0 })
    try {
      const outline = await (await task.promise).getOutline() as Entry[]
      const counts = (entries: readonly Entry[]): Array<[string, number | undefined]> =>
        entries.flatMap(entry => [[entry.title, entry.count] as [string, number | undefined], ...counts(entry.items)])
      expect(counts(outline)).toEqual([
        ['Closed', -3],
        ['Inside closed', undefined],
        ['Open inside closed', 1],
        ['Deep', undefined],
        ['Open', 3],
        ['Open inside open', 1],
        ['Leaf', undefined],
        ['Closed inside open', -1],
        ['Hidden', undefined],
      ])
      expect(outline.map(entry => Array.isArray(entry.dest) ? entry.dest[2] : undefined)).toEqual([24, 64])
    }
    finally {
      await task.destroy()
    }
  })

  // Children are laid out relative to their parent, so a nested entry or
  // destination that took its node's box as is pointed above and left of
  // its node.
  it('points a nested entry and a nested destination at their place on the page', async () => {
    const { bytes } = await renderPreparedPdfTemplate(defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, { size: [300, 400], style: { padding: 20 } }, () =>
        h(PdfView, { bookmark: 'Outer', style: { marginTop: 60, marginLeft: 30 } }, () =>
          h(PdfView, { bookmark: 'Inner', id: 'inner', style: { marginTop: 40, marginLeft: 10 } }, () => h(PdfText, null, () => 'Inner')))))), {})

    interface Entry { title: string, dest: unknown[], items: Entry[] }
    const task = getDocument({ data: Uint8Array.from(bytes), verbosity: 0 })
    try {
      const document = await task.promise
      const [outer] = await document.getOutline() as Entry[]
      // [page, XYZ, left, top, zoom]; the page is 400 high.
      expect(outer!.dest.slice(2, 4)).toEqual([50, 320])
      expect(outer!.items[0]!.dest.slice(2, 4)).toEqual([60, 280])
      expect((await document.getDestination('inner'))?.slice(2, 4)).toEqual([null, 280])
    }
    finally {
      await task.destroy()
    }
  })

  // The outline lists entries in source order among siblings, as the
  // structure tree reads. An absolute child placed by `bottom` goes with the
  // last part of its parent, so it paints on page 2 after the entries of
  // page 1: catches an outline in paint order, which put Abs after L1.
  it('lists a bookmarked absolute child that paints on a later page in source order', async () => {
    const line = (index: number) => index === 1 || index === 39 ? h(PdfView, { bookmark: `L${index}` }, () => h(PdfText, null, () => `L${index}`)) : h(PdfText, null, () => `Line ${index}`)
    const { bytes } = await renderPreparedPdfTemplate(defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, { size: 'A6', style: { padding: 20, fontSize: 10 } }, () =>
        h(PdfView, { bookmark: 'Section' }, () => [
          h(PdfView, { bookmark: 'Abs', style: { position: 'absolute', bottom: 0, right: 0 } }, () => h(PdfText, null, () => 'Abs')),
          ...Array.from({ length: 40 }, (_, index) => line(index + 1)),
        ])))), {})

    expect(await getPdfOutline(bytes)).toEqual([{ title: 'Section', expanded: false, children: ['Abs', 'L1', 'L39'].map(title => ({ title, children: [] })) }])
  })
})
