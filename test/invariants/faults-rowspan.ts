// Fault kinds for row spans (`rowspan` on PdfTableCell, components/table.ts).
// Each adds one small table with the fault to a page or view, so the rest of
// the document stays the valid generated one.
import { h, type VNode } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { append, host, invalid, type FaultKind } from './faults'

const { PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfView } = PDF_COMPONENTS

const cell = (text: string, props: Record<string, unknown> = {}): VNode => h(PdfTableCell, props, () => text)

/** Two columns: a first row whose first cell takes `spanProps`, then the rows of `below`. */
const spanTable = (spanProps: Record<string, unknown>, below: () => VNode[]): VNode =>
  h(PdfTable, { columns: [1, 1] }, () => [h(PdfTableRow, null, () => [cell('span', spanProps), cell('next')]), ...below()])

const belowRow = (props: Record<string, unknown> = {}): VNode => h(PdfTableRow, props, () => [cell('below')])

export const ROWSPAN_FAULTS: readonly FaultKind[] = [
  { id: 'rowspan-value', check: 'table.ts: rowspan', apply: (spec, pick) => {
    append(host(spec, pick), () => spanTable({ rowspan: [0, 1.5, -1][pick % 3] }, () => [belowRow()]))
    return invalid('PdfTableCell', /requires "rowspan" to be a whole number from 1/)
  } },
  { id: 'rowspan-text', check: 'table.ts: rowspan given as text', apply: (spec, pick) => {
    append(host(spec, pick), () => spanTable({ rowspan: '2' }, () => [belowRow()]))
    return invalid('PdfTableCell', /rowspan="2" passes the text "2", not a number/)
  } },
  { id: 'rowspan-past-end', check: 'table.ts: a row span past the last row', apply: (spec, pick) => {
    append(host(spec, pick), () => spanTable({ rowspan: 3 }, () => [belowRow()]))
    return invalid('PdfTableCell', /spans 3 rows, but its <PdfTable> has only 2 rows from its row to the end/)
  } },
  { id: 'rowspan-in-header', check: 'table.ts: no row span in a header', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfTable, { columns: [1, 1] }, () => [
      h(PdfTableHeader, null, () => [cell('head', { rowspan: 2 }), cell('next')]),
      belowRow(),
    ]))
    return invalid('PdfTableCell', /in <PdfTableHeader> cannot span rows/)
  } },
  { id: 'rowspan-wrap-row', check: 'table.ts: a row under a row span keeps wrap off', apply: (spec, pick) => {
    append(host(spec, pick), () => spanTable({ rowspan: 2 }, () => [belowRow({ wrap: true })]))
    return invalid('PdfTableRow', /sets wrap, but a rowspan covers it/)
  } },
  { id: 'rowspan-break-row', check: 'table.ts: no break inside a row span', apply: (spec, pick) => {
    append(host(spec, pick), () => spanTable({ rowspan: 2 }, () => [belowRow({ break: true })]))
    return invalid('PdfTableRow', /sets break, but a rowspan from a row above covers it/)
  } },
  { id: 'rowspan-overlap', check: 'table.ts: a column span over a column a row span takes', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfTable, { columns: [1, 1, 1] }, () => [
      h(PdfTableRow, null, () => [cell('a'), cell('span', { rowspan: 2 }), cell('c')]),
      h(PdfTableRow, null, () => [cell('wide', { colspan: 2 })]),
    ]))
    return invalid('PdfTableCell', /but a rowspan from a row above takes column 2/)
  } },
  { id: 'rowspan-nested-row', check: 'table.ts: the rows of a row span are rows of the table itself', apply: (spec, pick) => {
    append(host(spec, pick), () => spanTable({ rowspan: 2 }, () => [h(PdfView, null, () => [belowRow()])]))
    return invalid('PdfTableRow', /is covered by a rowspan, so it must be a row of its <PdfTable> itself/)
  } },
  { id: 'rowspan-over-columns', check: 'table.ts: row width counted with the columns of row spans above', apply: (spec, pick) => {
    append(host(spec, pick), () => spanTable({ rowspan: 2 }, () => [h(PdfTableRow, null, () => [cell('one'), cell('two')])]))
    return invalid('PdfTableRow', /needs 3 columns \(counting colspan and the columns of row spans above\)/)
  } },
]
