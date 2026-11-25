import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { defineComponent, h, type Component } from 'vue'
import { PDF_COMPONENTS } from '../../../src/runtime/components'
import type { BundledPdfFontDescriptor, PdfFontDataUrl } from '../../../src/runtime/fonts'
import type { PdfTableColumn } from '../../../src/runtime/components/table'
import type { PdfTemplateRuntimeOptions } from '../../../src/runtime/server/registry'
import { PDF_DEFINITION_PROPERTY, type PdfDefinition } from '../../../src/runtime/shared/template'

// The documents of the speed budget: `test/performance.test.ts` times them,
// `test/work-budget.test.ts` counts their work. One source for both.

const {
  PdfDocument, PdfFootnote, PdfImage, PdfPage, PdfPageCount, PdfPageNumber, PdfPageRef, PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfText, PdfView,
} = PDF_COMPONENTS

const asTemplate = (component: Component, definition: PdfDefinition = {}): Component =>
  Object.assign(component, { [PDF_DEFINITION_PROPERTY]: definition })

/** One page, 41 short texts in the standard font. */
export const invoice = asTemplate(defineComponent({
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
}), { title: 'Performance invoice' })

/** 100 explicit small pages, one text each. */
export const hundredPages = asTemplate(defineComponent({
  name: 'PerformanceHundredPages',
  setup: () => () => h(PdfDocument, {}, {
    default: () => Array.from({ length: 100 }, (_, index) =>
      h(PdfPage, { size: [180, 120] }, {
        default: () => h(PdfText, {}, { default: () => `Page ${index + 1}` }),
      })),
  }),
}))

/**
 * `count` one-line texts in a view with `minHeight: 10` on A6 pages. The
 * content passes the `minHeight` on the first page, so the cut enters the
 * view's rests as it enters a view without one (layout/paginate/cut.ts,
 * `passesMinHeight`).
 */
export const minHeightStack = asTemplate(defineComponent({
  name: 'PerformanceMinHeightStack',
  props: { count: { required: true, type: Number } },
  setup: props => () => h(PdfDocument, {}, {
    default: () => h(PdfPage, { size: 'A6' }, {
      default: () => h(PdfView, { style: { minHeight: 10 } }, {
        default: () => Array.from({ length: props.count }, (_, index) => h(PdfText, {}, { default: () => `line ${index}` })),
      }),
    }),
  }),
}))

/** A page reference to a later page: two layout passes. */
export const multiPassReport = asTemplate(defineComponent({
  name: 'PerformanceMultiPass',
  setup() {
    return () => h(PdfDocument, {}, {
      default: () => [
        h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
          default: () => h(PdfText, {}, { default: () => ['Section ..... ', h(PdfPageRef, { to: 'section' })] }),
        }),
        h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
          default: () => [
            h(PdfText, { id: 'section', style: { fontSize: 20 } }, { default: () => 'Section' }),
            ...Array.from({ length: 80 }, (_, index) =>
              h(PdfText, { style: { fontSize: 10 } }, { default: () => `Report row ${index + 1}` })),
          ],
        }),
      ],
    })
  },
}), { maxPasses: 4 })

const font = (file: string, family: string, fontWeight: number): BundledPdfFontDescriptor => ({
  family,
  fontWeight,
  src: `data:font/ttf;base64,${readFileSync(`playground/pdfs/fonts/${file}`).toString('base64')}` as PdfFontDataUrl,
})

/** The fonts of `realInvoice`: Inter in two weights for the body and figures, Lora for the headings. */
export const realInvoiceOptions: PdfTemplateRuntimeOptions = {
  fonts: [font('Inter-400.ttf', 'Inter', 400), font('Inter-700.ttf', 'Inter', 700), font('Lora-400.ttf', 'Lora', 400)],
}

const chunk = (type: string, data: Uint8Array): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

/** A 160 × 48 RGB logo: a green band with a lighter mark, rows unfiltered. */
const logo = (): Uint8Array => {
  const [width, height] = [160, 48]
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const mark = x > 8 && x < 40 && y > 8 && y < 40
      rows.set(mark ? [214, 232, 205] : [49, 93, 59], y * (width * 3 + 1) + 1 + x * 3)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array())])
}
const LOGO = logo()

const SERVICES = ['Field survey', 'Habitat mapping', 'Species inventory', 'Water sampling', 'Report drafting', 'Stakeholder workshop']

/**
 * A real-shaped invoice: a logo and a header, 160 table rows over 6 to 8 A4
 * pages with a repeated table header, a fixed footer with the page number and
 * count, and totals; two families, three faces. With `rateRows` above 1, each
 * rate cell spans that many rows (`rowspan`), and the rows it covers leave
 * the rate column out.
 */
const realInvoiceWith = (name: string, columns: readonly PdfTableColumn[], rateRows = 1) => asTemplate(defineComponent({
  name,
  setup: () => () => h(PdfDocument, { title: 'Invoice 2026-0142' }, {
    default: () => h(PdfPage, { size: 'A4', style: { fontFamily: 'Inter', fontSize: 9, paddingTop: 48, paddingBottom: 64, paddingHorizontal: 48 } }, {
      default: () => [
        h(PdfImage, { src: LOGO, style: { width: 80, height: 24, marginBottom: 12 } }),
        h(PdfText, { style: { fontFamily: 'Lora', fontSize: 22, marginBottom: 4 } }, { default: () => 'Invoice 2026-0142' }),
        h(PdfText, { style: { color: '#758078', marginBottom: 18 } }, { default: () => 'Alder Valley Conservation Trust · 12 Mill Lane · Ashford' }),
        h(PdfTable, { columns }, {
          default: () => [
            h(PdfTableHeader, { style: { fontWeight: 700, borderBottomWidth: 1, borderBottomColor: '#315D3B' } }, {
              default: () => ['#', 'Description', 'Qty', 'Rate', 'Amount'].map(label => h(PdfTableCell, { style: { paddingVertical: 4 } }, { default: () => label })),
            }),
            ...Array.from({ length: 160 }, (_, index) => {
              const hours = (index % 7) + 1
              const rate = 85 + (Math.floor(index / rateRows) % 4) * 10
              const rateCell = index % rateRows === 0
                ? [h(PdfTableCell, { style: { paddingVertical: 3, textAlign: 'right' }, ...(rateRows > 1 ? { rowspan: Math.min(rateRows, 160 - index) } : {}) }, { default: () => `EUR ${rate}.00` })]
                : []
              return h(PdfTableRow, { style: { borderBottomWidth: 0.5, borderBottomColor: '#dfe4df' } }, {
                default: () => [
                  h(PdfTableCell, { style: { paddingVertical: 3 } }, { default: () => String(index + 1) }),
                  h(PdfTableCell, { style: { paddingVertical: 3 } }, {
                    default: () => [
                      h(PdfText, null, { default: () => `${SERVICES[index % SERVICES.length]}, plot ${index + 1}` }),
                      h(PdfText, { style: { color: '#758078', fontSize: 8 } }, { default: () => `Week ${(index % 12) + 1}, site visit and notes` }),
                    ],
                  }),
                  h(PdfTableCell, { style: { paddingVertical: 3, textAlign: 'right' } }, { default: () => `${hours} h` }),
                  ...rateCell,
                  h(PdfTableCell, { style: { paddingVertical: 3, textAlign: 'right', fontWeight: 700 } }, { default: () => `EUR ${hours * rate}.00` }),
                ],
              })
            }),
          ],
        }),
        h(PdfView, { style: { marginTop: 16, alignItems: 'flex-end' } }, {
          default: () => [
            h(PdfText, null, { default: () => 'Subtotal EUR 53,120.00' }),
            h(PdfText, null, { default: () => 'VAT 20 % EUR 10,624.00' }),
            h(PdfText, { style: { fontFamily: 'Lora', fontSize: 14, marginTop: 4 } }, { default: () => 'Total EUR 63,744.00' }),
          ],
        }),
        h(PdfText, { fixed: true, style: { position: 'absolute', bottom: 28, left: 48, right: 48, fontSize: 8, color: '#758078', textAlign: 'right' } }, {
          default: () => ['Invoice 2026-0142 · Page ', h(PdfPageNumber), ' of ', h(PdfPageCount)],
        }),
      ],
    }),
  }),
}))

export const realInvoice = realInvoiceWith('PerformanceRealInvoice', ['28pt', 1, '52pt', '78pt', '86pt'])

/** The real-shaped invoice with 'auto' columns for the number and the figures. */
export const realInvoiceAuto = realInvoiceWith('PerformanceRealInvoiceAuto', ['auto', 1, 'auto', 'auto', 'auto'])

/** The real-shaped invoice with each rate over four rows. */
export const realInvoiceSpans = realInvoiceWith('PerformanceRealInvoiceSpans', ['28pt', 1, '52pt', '78pt', '86pt'], 4)

/**
 * A long table: 1,370 rows of two lines over 50 A4 pages, with a
 * repeated header and a fixed footer with the page number and count. Each
 * rest of the page is laid out before its split, so this is where the cost
 * of those layouts shows (layout/paginate/cut.ts).
 */
export const longTable = asTemplate(defineComponent({
  name: 'PerformanceLongTable',
  setup: () => () => h(PdfDocument, { title: 'Survey log' }, {
    default: () => h(PdfPage, { size: 'A4', style: { fontSize: 9, paddingTop: 48, paddingBottom: 64, paddingHorizontal: 48 } }, {
      default: () => [
        h(PdfText, { style: { fontSize: 18, marginBottom: 12 } }, { default: () => 'Survey log 2026' }),
        h(PdfTable, { columns: ['36pt', 1, '72pt'] }, {
          default: () => [
            h(PdfTableHeader, { style: { fontWeight: 700, borderBottomWidth: 1 } }, {
              default: () => ['#', 'Observation', 'Site'].map(label => h(PdfTableCell, { style: { paddingVertical: 4 } }, { default: () => label })),
            }),
            ...Array.from({ length: 1370 }, (_, index) => h(PdfTableRow, { style: { borderBottomWidth: 0.5, borderBottomColor: '#dfe4df' } }, {
              default: () => [
                h(PdfTableCell, { style: { paddingVertical: 3 } }, { default: () => String(index + 1) }),
                h(PdfTableCell, { style: { paddingVertical: 3 } }, {
                  default: () => [
                    h(PdfText, null, { default: () => `${SERVICES[index % SERVICES.length]}, plot ${index + 1}` }),
                    h(PdfText, { style: { color: '#758078', fontSize: 8 } }, { default: () => `Week ${(index % 12) + 1}, transect ${(index % 9) + 1}` }),
                  ],
                }),
                h(PdfTableCell, { style: { paddingVertical: 3, textAlign: 'right' } }, { default: () => `Site ${(index % 23) + 1}` }),
              ],
            })),
          ],
        }),
        h(PdfText, { fixed: true, style: { position: 'absolute', bottom: 28, left: 48, right: 48, fontSize: 8, textAlign: 'right' } }, {
          default: () => ['Survey log · Page ', h(PdfPageNumber), ' of ', h(PdfPageCount)],
        }),
      ],
    }),
  }),
}))

/**
 * A table of 1,000 one-line rows in which every row keeps with the next
 * (`keepWithNext`): the longest chain of keeps, which `endOfKeep` walks
 * from every row that pagination reads (layout/paginate/split-keep.ts).
 */
export const keepingTable = asTemplate(defineComponent({
  name: 'PerformanceKeepingTable',
  setup: () => () => h(PdfDocument, {}, {
    default: () => h(PdfPage, { size: 'A4', style: { padding: 40, fontSize: 10 } }, {
      default: () => [
        h(PdfTable, { columns: [1, '60pt'] }, {
          default: () => Array.from({ length: 1000 }, (_, index) => h(PdfTableRow, { keepWithNext: index < 999 }, {
            default: () => [h(PdfTableCell, null, { default: () => `Row ${index + 1}` }), h(PdfTableCell, null, { default: () => String(index + 1) })],
          })),
        }),
      ],
    }),
  }),
}))

const CLAUSE = 'The contractor carries out the survey with the care of a qualified expert and reports each finding that affects the habitat, the water quality or the species named in the order. Changes to the scope need the written consent of both parties; costs that follow from a change are agreed before the work starts. Data collected under this agreement belong to the client, who grants the contractor a licence to use them for scientific publications without personal data.'

/**
 * General terms: 120 numbered clauses of one heading and one paragraph,
 * with a full-width section title before every 30. With `columns`, the
 * clauses run in two columns and the titles span both (layout/columns); the
 * same text in one column is the reference for the cost of a column fill.
 */
/** The general terms, in one column or two; with `notes`, every fifth clause title ends with a footnote. */
const termsWith = (name: string, columns: boolean, notes = false) => asTemplate(defineComponent({
  name,
  setup: () => () => h(PdfDocument, { title: 'General terms' }, {
    default: () => h(PdfPage, { size: 'A4', style: { padding: 40, fontSize: 8 } }, {
      default: () => h(PdfView, { style: columns ? { columnCount: 2, columnGap: 16 } : {} }, {
        default: () => Array.from({ length: 120 }, (_, index) => [
          ...(index % 30 === 0 ? [h(PdfText, { style: { columnSpan: 'all', fontSize: 14, fontWeight: 700, marginVertical: 8 } }, { default: () => `Part ${index / 30 + 1}` })] : []),
          h(PdfText, { keepWithNext: true, style: { fontWeight: 700, marginTop: 6 } }, { default: () => notes && index % 5 === 0 ? [`§ ${index + 1} Clause ${index + 1}`, h(PdfFootnote, null, { default: () => `See the annex, section ${index + 1}: the terms of this clause apply as amended there.` })] : `§ ${index + 1} Clause ${index + 1}` }),
          h(PdfText, { style: { textAlign: 'justify' } }, { default: () => CLAUSE }),
        ]).flat(),
      }),
    }),
  }),
}))

export const terms = termsWith('PerformanceTerms', false)
export const termsColumns = termsWith('PerformanceTermsColumns', true)
export const termsColumnsNotes = termsWith('PerformanceTermsColumnsNotes', true, true)
