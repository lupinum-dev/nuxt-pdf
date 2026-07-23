import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import type { DocumentNode } from '@react-pdf/layout'
import {
  PdfDocument,
  PdfLink,
  PdfPage,
  PdfText,
  PdfView,
} from '../src/runtime/components'
import { usePdfPageNumbers } from '../src/runtime/composables'
import { mountPdfComponent } from '../src/runtime/renderer'
import {
  renderDocumentMultiPass,
  type DestinationPageMap,
  type MultiPassSource,
} from '../src/runtime/server/engine/layout-passes'
import {
  comparePageImages,
  decodePngPage,
  parsePdf,
  rasterizePdf,
} from './utils/pdf'

// A realistic multi-section report: a table of contents with dotted leaders and
// internal links, section id targets (one section long enough to span pages so
// the numbers come from real pagination, not section order), and dynamic page
// footers. This is a Vue-only conformance fixture — React PDF has no
// table-of-contents mechanism to pair against, so the oracle is the document's
// own located headings plus a reviewed raster baseline of the TOC page.
interface Section { id: string, title: string, paragraphs: number }
const SECTIONS: Section[] = [
  { id: 'overview', title: 'Overview', paragraphs: 2 },
  { id: 'architecture', title: 'Architecture', paragraphs: 24 }, // spans pages
  { id: 'results', title: 'Results', paragraphs: 3 },
  { id: 'appendix', title: 'Appendix', paragraphs: 2 },
]

const footer = (): VNode =>
  h(PdfText, {
    fixed: true,
    style: { position: 'absolute', bottom: 28, left: 48, right: 48, fontSize: 9, color: '#6A756D', textAlign: 'center' },
    render: ({ pageNumber, totalPages }: { pageNumber: number, totalPages?: number }) => `Page ${pageNumber} of ${totalPages}`,
  })

const tocEntry = (section: Section, page: number | undefined): VNode =>
  h(PdfLink, { src: `#${section.id}`, style: { color: '#18251D', textDecoration: 'none', marginBottom: 12 } }, {
    default: () =>
      h(PdfView, { style: { flexDirection: 'row', alignItems: 'flex-end' } }, {
        default: () => [
          h(PdfText, { style: { fontSize: 12 } }, { default: () => section.title }),
          h(PdfView, { style: { flex: 1, marginHorizontal: 6, marginBottom: 3, borderBottomWidth: 1, borderBottomColor: '#C7CFC9', borderBottomStyle: 'dotted' } }),
          h(PdfText, { style: { fontSize: 12 } }, { default: () => String(page ?? '') }),
        ],
      }),
  })

const ReportDocument = defineComponent({
  name: 'ReportDocument',
  setup() {
    const pageNumbers = usePdfPageNumbers()
    return () =>
      h(PdfDocument, { title: 'Field Report', creationDate: new Date(0) }, {
        default: () => [
          h(PdfPage, { size: 'A4', style: { paddingVertical: 56, paddingHorizontal: 48, fontFamily: 'Helvetica' } }, {
            default: () => [
              h(PdfText, { style: { fontSize: 10, letterSpacing: 1.4, color: '#47734F', marginBottom: 8 } }, { default: () => 'FIELD REPORT' }),
              h(PdfText, { style: { fontSize: 26, marginBottom: 32 } }, { default: () => 'Table of Contents' }),
              ...SECTIONS.map(section => tocEntry(section, pageNumbers[section.id])),
              footer(),
            ],
          }),
          ...SECTIONS.map(section =>
            h(PdfPage, { size: 'A4', style: { paddingVertical: 56, paddingHorizontal: 48, fontFamily: 'Helvetica' } }, {
              default: () => [
                h(PdfText, { id: section.id, break: true, style: { fontSize: 20, marginBottom: 16 } }, { default: () => section.title }),
                ...Array.from({ length: section.paragraphs }, (_, i) =>
                  h(PdfText, { style: { fontSize: 11, lineHeight: 1.5, marginBottom: 8, color: '#2A362E' } }, {
                    default: () => `${section.title} paragraph ${i + 1}. Nuxt PDF lays this document out repeatedly until the printed page numbers match where each section truly begins.`,
                  }),
                ),
                footer(),
              ],
            }),
          ),
        ],
      })
  },
})

const mountedSource = (
  mounted: Awaited<ReturnType<typeof mountPdfComponent>>,
): MultiPassSource => ({
  get document() {
    return mounted.document as unknown as DocumentNode
  },
  feed: async (pages: DestinationPageMap) => {
    await mounted.feedPageNumbers(pages)
  },
})

const baselineDirectory = fileURLToPath(new URL('./fixtures/baselines/toc', import.meta.url))
const baselineName = 'toc-page-1.png'
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'
const rasterThresholds = { channelThreshold: 25, maxChangedPixelRatio: 0.005 } as const

const locateHeadingPages = (pages: { number: number, text: string }[]): DestinationPageMap => {
  const located: DestinationPageMap = {}
  for (const section of SECTIONS) {
    const page = pages.find(p => p.text.includes(section.title) && p.text.includes('paragraph 1.'))
    if (page) located[section.id] = page.number
  }
  return located
}

describe('table-of-contents conformance (Vue-only)', () => {
  it('converges, prints located page numbers, links to section starts, and matches its raster baseline', async () => {
    const mounted = await mountPdfComponent(ReportDocument, {})
    try {
      const result = await renderDocumentMultiPass(mountedSource(mounted))

      // An ordinary document converges in exactly two passes: pass 1 discovers
      // the map, pass 2 confirms it is a fixed point.
      expect(result.passes).toBe(2)

      const parsed = await parsePdf(result.bytes)
      expect(parsed.pageCount).toBe(result.layout.children.length)

      // The long Architecture section pushes later sections past a naive 1:1 with
      // section order — proving the numbers come from pagination.
      const located = locateHeadingPages(parsed.pages)
      expect(Object.keys(located)).toHaveLength(SECTIONS.length)
      expect(result.pages).toEqual(located)
      expect(located.results!).toBeGreaterThan(located.architecture! + 1)

      // The TOC page prints exactly those page numbers.
      const tocText = parsed.pages[0]!.text
      for (const section of SECTIONS) {
        expect(tocText).toContain(`${section.title}`)
        expect(tocText).toContain(String(located[section.id]))
      }

      // Every dynamic footer shows its own page number.
      for (const page of parsed.pages) {
        expect(page.text).toContain(`Page ${page.number} of ${parsed.pageCount}`)
      }

      // Reviewed raster baseline of the TOC page.
      const [tocPage] = await rasterizePdf(result.bytes)
      if (updatePdfBaselines) {
        await mkdir(baselineDirectory, { recursive: true })
        await writeFile(`${baselineDirectory}/${baselineName}`, tocPage!.png)
      }
      const baselinePng = await readFile(`${baselineDirectory}/${baselineName}`)
      const baseline = await decodePngPage(baselinePng, 1)
      const regression = comparePageImages(tocPage!, baseline, rasterThresholds)
      if (!regression.matches) {
        const artifactDirectory = resolve('reports/pdf-snapshots/toc')
        await mkdir(artifactDirectory, { recursive: true })
        await Promise.all([
          writeFile(`${artifactDirectory}/actual.png`, tocPage!.png),
          writeFile(`${artifactDirectory}/expected.png`, baselinePng),
          writeFile(
            `${artifactDirectory}/metrics.json`,
            `${JSON.stringify(regression, null, 2)}\n`,
          ),
        ])
      }
      expect(regression, 'TOC page reviewed baseline mismatch').toMatchObject({
        dimensionsMatch: true,
        matches: true,
        pageNumbersMatch: true,
      })
    }
    finally {
      mounted.unmount()
    }
  }, 30_000)
})
