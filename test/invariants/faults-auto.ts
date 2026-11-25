// Fault kinds for 'auto' table columns (components/table.ts). Each adds one
// small table with the fault to a page or view, so the rest of the document
// stays the valid generated one.
import { defineComponent, h, type Component, type VNode } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { append, host, invalid, type FaultKind } from './faults'

const { PdfImage, PdfSvg, PdfTable, PdfTableCell, PdfTableRow, PdfText, PdfTextField, PdfView } = PDF_COMPONENTS
// A wrong column passes a value the typed props cannot describe.
const PlainTable: Component = PdfTable

/** A share column and an 'auto' column; the 'auto' cell holds `content` inside a local component. */
const autoTable = (content: () => VNode): VNode => h(PdfTable, { columns: [1, 'auto'] }, () => [h(PdfTableRow, null, () => [
  h(PdfTableCell, null, () => 'text'),
  h(PdfTableCell, null, () => [h(PdfView, null, () => [h(defineComponent(() => () => content()))])]),
])])

const UNMEASURABLE: readonly { id: string, content: () => VNode, element: string, name: string }[] = [
  { id: 'auto-image', content: () => h(PdfImage, { src: 'logo.png' }), element: 'PdfImage', name: '<PdfImage>' },
  { id: 'auto-svg', content: () => h(PdfSvg, { viewBox: '0 0 10 10' }), element: 'PdfSvg', name: '<PdfSvg>' },
  { id: 'auto-field', content: () => h(PdfTextField, { name: 'autoField' }), element: 'PdfTextField', name: '<PdfTextField>' },
  { id: 'auto-row-view', content: () => h(PdfView, { style: { flexDirection: 'row' } }, () => [h(PdfText, null, () => 'a')]), element: 'PdfView', name: '<PdfView> with flexDirection \'row\'' },
]

export const AUTO_COLUMN_FAULTS: readonly FaultKind[] = [
  { id: 'auto-spelling', check: 'table.ts: \'auto\' written otherwise', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PlainTable, { columns: [1, ['Auto', 'AUTO', 'auto '][pick % 3]] }, () => []))
    return invalid('PdfTable', /requires "columns": a non-empty list of shares \(numbers\), widths \('30%', '80pt'\), 'auto', or \{ width, align, style \}/)
  } },
  ...UNMEASURABLE.map(({ id, content, element, name }): FaultKind => ({
    id,
    check: 'table.ts: an unmeasurable cell in an \'auto\' column needs a width',
    apply: (spec, pick) => {
      append(host(spec, pick), () => autoTable(content))
      return invalid(element, new RegExp(`${name.replace(/[<>]/g, '\\$&')} in an 'auto' table column needs a width of its own`))
    },
  })),
  { id: 'auto-percentage-span', check: 'table.ts: no span over a percentage and an \'auto\' column', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfTable, { columns: ['30%', 'auto'] }, () => [h(PdfTableRow, null, () => [
      h(PdfTableCell, { colspan: 2 }, () => 'wide'),
    ])]))
    return invalid('PdfTableCell', /spans a percentage column and an 'auto' or share column/)
  } },
]
