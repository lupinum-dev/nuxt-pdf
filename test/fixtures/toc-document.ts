import type { DocumentNode } from '@react-pdf/layout'
import { defineComponent, h, type VNode } from 'vue'
import {
  PdfDocument,
  PdfLink,
  PdfPage,
  PdfText,
  PdfView,
} from '../../src/runtime/components'
import { usePdfPageNumbers } from '../../src/runtime/composables'
import { mountPdfComponent } from '../../src/runtime/renderer'
import {
  renderDocumentMultiPass,
  type DestinationPageMap,
  type MultiPassSource,
} from '../../src/runtime/server/engine/layout-passes'

export interface TocSection {
  id: string
  title: string
  paragraphs: number
}

export const tocSections: TocSection[] = [
  { id: 'overview', title: 'Overview', paragraphs: 2 },
  { id: 'architecture', title: 'Architecture', paragraphs: 24 },
  { id: 'results', title: 'Results', paragraphs: 3 },
  { id: 'appendix', title: 'Appendix', paragraphs: 2 },
]

const footer = (): VNode =>
  h(PdfText, {
    fixed: true,
    style: { position: 'absolute', bottom: 28, left: 48, right: 48, fontSize: 9, color: '#6A756D', textAlign: 'center' },
    render: ({ pageNumber, totalPages }: { pageNumber: number, totalPages?: number }) => `Page ${pageNumber} of ${totalPages}`,
  })

const tocEntry = (
  section: TocSection,
  page: number | undefined,
): VNode =>
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
              ...tocSections.map(section => tocEntry(section, pageNumbers[section.id])),
              footer(),
            ],
          }),
          ...tocSections.map(section =>
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

export const renderTocDocument = async () => {
  const mounted = await mountPdfComponent(ReportDocument, {})
  try {
    return await renderDocumentMultiPass(mountedSource(mounted))
  }
  finally {
    mounted.unmount()
  }
}
