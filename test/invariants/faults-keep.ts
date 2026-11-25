// Fault kinds for keepWithNext (renderer/validate-tree.ts). Each adds one small
// node with the fault to a page or view, so the rest of the document stays
// the valid generated one.
import { h } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { append, host, invalid, type FaultKind } from './faults'

const { PdfText, PdfView } = PDF_COMPONENTS

export const KEEP_WITH_NEXT_FAULTS: readonly FaultKind[] = [
  { id: 'keep-with-next-in-row', check: 'validate-tree.ts: no keepWithNext on a child of a row', apply: (spec, pick) => {
    const direction = pick % 2 === 0 ? 'row' : 'row-reverse'
    append(host(spec, pick), () => h(PdfView, { style: { flexDirection: direction } }, () => [
      h(PdfText, { keepWithNext: true }, () => 'kept'),
      h(PdfText, null, () => 'beside'),
    ]))
    return invalid('PdfText', new RegExp(`cannot have "keepWithNext" inside <PdfView>, whose flexDirection is "${direction}"`))
  } },
  { id: 'keep-with-next-in-column-reverse', check: 'validate-tree.ts: no keepWithNext on a child of a column-reverse container', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfView, { style: { flexDirection: 'column-reverse' } }, () => [
      h(PdfText, { keepWithNext: true }, () => 'kept'),
      h(PdfText, null, () => 'above'),
    ]))
    return invalid('PdfText', /cannot have "keepWithNext" inside <PdfView>, whose flexDirection is "column-reverse"/)
  } },
  { id: 'keep-with-next-on-fixed', check: 'validate-tree.ts: no keepWithNext on a fixed node', apply: (spec, pick) => {
    const element = pick % 2 === 0 ? 'PdfText' : 'PdfView'
    append(host(spec, pick), () => element === 'PdfText'
      ? h(PdfText, { fixed: true, keepWithNext: true }, () => 'repeated')
      : h(PdfView, { fixed: true, keepWithNext: true }, () => [h(PdfText, null, () => 'repeated')]))
    return invalid(element, /cannot have "keepWithNext": it is a fixed node that repeats on every page/)
  } },
]
