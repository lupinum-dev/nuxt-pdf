// Floats (D49): a node with `float: 'top' | 'bottom'` leaves the flow for the
// top or the bottom of its area, a column or the page content area.
import { defineComponent, h, type Component, type VNodeChild } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import { parsePdf } from '../src/test/pdf'

// Some rows pass props the typed components reject, so they are used as plain components.
const PLAIN: Readonly<Record<keyof typeof PDF_COMPONENTS, Component>> = PDF_COMPONENTS
const { PdfDocument, PdfFootnote, PdfLink, PdfPage, PdfPageRef, PdfTable, PdfTableCell, PdfTableRow, PdfText, PdfView } = PLAIN

/** An A6 page, 20 pt padding, 10 pt text: 11 pt lines, the content area from 20 to 399.5 pt. */
const documentOf = (children: () => VNodeChild, { style, ...pageProps }: Record<string, unknown> = {}) => defineComponent(() => () =>
  h(PdfDocument, { creationDate: new Date(0) }, () => h(PdfPage, { size: 'A6', ...pageProps, style: { padding: 20, fontSize: 10, ...(style as object) } }, children)))

/** Renders the page's children; `page` adds page props. */
const render = async (children: () => VNodeChild, { page, ...options }: { maxPasses?: number, page?: Record<string, unknown> } = {}) => {
  const mounted = await mountPdfComponent(documentOf(children, page))
  try {
    const result = await renderPlainDocument(mounted.document, options)
    return { result, pdf: await parsePdf(result.bytes) }
  }
  finally {
    mounted.unmount()
  }
}

/** Each page's texts with their left edge and their baseline from the page top. */
const runsOf = async (children: () => VNodeChild, page?: Record<string, unknown>) => {
  const { pdf } = await render(children, { page })
  return pdf.pages.map(page => page.textRuns.map(run => [run.text, Math.round(run.x), Math.round((page.height - run.y) * 10) / 10] as const))
}

/** Where each named text prints: page, left edge, baseline. */
const placesOf = async (children: () => VNodeChild, names: string[], page?: Record<string, unknown>) => {
  const pages = await runsOf(children, page)
  return Object.fromEntries(names.map((name) => {
    const page = pages.findIndex(runs => runs.some(([text]) => text === name))
    const run = pages[page]?.find(([text]) => text === name)
    return [name, run ? [page + 1, run[1], run[2]] : undefined]
  }))
}

const lines = (from: number, count: number) => Array.from({ length: count }, (_, line) => h(PdfText, null, () => `Line ${from + line}`))
const figure = (name: string, side: 'top' | 'bottom', height = 60, props: Record<string, unknown> = {}) =>
  h(PdfView, { ...props, style: { float: side, height, backgroundColor: '#dddddd' } }, () => [h(PdfText, null, () => name)])

describe('floats on a page', () => {
  // Catches a float left at its place in the flow, or moved to a page other than its anchor's.
  it('places a top float at the top of the page that holds its anchor, and a bottom float at its bottom', async () => {
    expect(await placesOf(() => [...lines(1, 10), figure('Top', 'top'), ...lines(11, 10), figure('Bottom', 'bottom'), ...lines(21, 5)], ['Top', 'Line 1', 'Line 25', 'Bottom'])).toEqual({
      // 60 pt above Line 1, at 20 pt; at the content end, 399.5 pt; two floats leave page 1 room for 23 lines.
      'Top': [1, 20, 29],
      'Line 1': [1, 20, 89],
      'Bottom': [1, 20, 348.5],
      'Line 25': [2, 20, 40],
    })
  })

  // Catches a bottom float placed below a footer written after the flow, or at the end of the flow.
  it('places a bottom float above a fixed footer written after the flow', async () => {
    expect(await placesOf(() => [...lines(1, 5), figure('Bottom', 'bottom'), h(PdfText, { fixed: true }, () => 'Footer')], ['Line 5', 'Bottom', 'Footer'])).toEqual({
      'Line 5': [1, 20, 73],
      // It ends at 388.5 pt, where the footer starts.
      'Bottom': [1, 20, 337.5],
      'Footer': [1, 20, 397.5],
    })
  })

  // Catches a float placed on a page before the page that holds its anchor.
  it('never places a float before the page of its anchor', async () => {
    expect(await placesOf(() => [...lines(1, 40), figure('Late', 'top'), ...lines(41, 5)], ['Line 34', 'Late', 'Line 35', 'Line 41'])).toEqual({
      // Page 1 ends with Line 34, before the anchor after Line 40.
      'Line 34': [1, 20, 392],
      'Late': [2, 20, 29],
      'Line 35': [2, 20, 89],
      'Line 41': [2, 20, 155],
    })
  })

  // Catches a flow that waits for a float: the text after a queued float goes on in this area.
  it('queues a float that does not fit and lets the text after it flow on', async () => {
    expect(await placesOf(() => [...lines(1, 20), figure('Tall', 'top', 300), ...lines(21, 20)], ['Line 21', 'Line 34', 'Tall', 'Line 35'])).toEqual({
      'Line 21': [1, 20, 249],
      'Line 34': [1, 20, 392],
      'Tall': [2, 20, 29],
      'Line 35': [2, 20, 329],
    })
  })

  // Catches a later float of one side that overtakes an earlier one of that side.
  it('never lets a float overtake an earlier one of its side', async () => {
    expect(await placesOf(() => [...lines(1, 20), figure('First', 'top', 300), figure('Second', 'top', 20), ...lines(21, 20)], ['First', 'Second', 'Line 35'])).toEqual({
      // Second would fit on page 1 below Line 20, but follows First.
      'First': [2, 20, 29],
      'Second': [2, 20, 329],
      'Line 35': [2, 20, 349],
    })
  })

  // Catches floats with one anchor that change order when the anchor is on the next page (found by I28).
  it('keeps the order of floats with one anchor on a later page', async () => {
    expect(await placesOf(() => [...lines(1, 40), figure('One', 'bottom', 20), figure('Two', 'bottom', 20), ...lines(41, 2)], ['One', 'Two'])).toEqual({
      One: [2, 20, 368.5],
      Two: [2, 20, 388.5],
    })
  })

  // Catches a heading that a float between it and its paragraph separates from the paragraph.
  it('keeps a heading with the paragraph after a float, as if the float were not there', async () => {
    expect(await placesOf(() => [...lines(1, 30), h(PdfText, { keepWithNext: true }, () => 'Heading'), figure('Figure', 'top', 100), ...lines(31, 5)], ['Line 30', 'Heading', 'Line 31', 'Figure'])).toEqual({
      // With the figure on page 1 its anchor would move to page 2: the figure goes there, the heading stays with Line 31.
      'Line 30': [1, 20, 348],
      'Heading': [1, 20, 359],
      'Line 31': [1, 20, 370],
      'Figure': [2, 20, 29],
    })
  })

  // Catches a note that stays on the page of the float's place in the flow instead of the page it prints on.
  it('prints the note of a mark inside a float on the page of the float', async () => {
    const pages = await runsOf(() => [...lines(1, 28), h(PdfView, { style: { float: 'top', height: 120 } }, () => [h(PdfText, null, () => ['Caption', h(PdfFootnote, () => 'The note.')])]), ...lines(29, 10)])
    expect(pages.map(runs => runs.filter(([text]) => text.includes('note') || text.startsWith('Caption')).map(([text]) => text))).toEqual([[], ['Caption', 'The note.']])
  })

  // Catches a page that ends its flow where the note of a waiting float would have started, with its bottom float above blank room.
  it('fills the page and keeps its bottom float at the end when a float waits because its note does not fit', async () => {
    const noted = h(PdfView, { style: { float: 'top', height: 320 } }, () => [h(PdfText, null, () => ['Big ', h(PdfFootnote, () => 'The note.')])])
    expect(await placesOf(() => [...lines(1, 1), figure('Low', 'bottom', 20), ...lines(2, 2), noted, ...lines(4, 30)], ['Low', 'Line 32', 'Line 33', 'Big'])).toEqual({
      // The 320 pt float fits page 1 only without its note, so it waits; Line 32 then still fits above Low.
      'Low': [1, 20, 388.5],
      'Line 32': [1, 20, 370],
      'Line 33': [2, 20, 349],
      'Big': [2, 20, 29.6],
    })
  })

  // Catches a note lost when the page is filled once more for a float that waits for room for its note.
  it('prints the notes of the floats that stay when another waits because its note does not fit', async () => {
    const noted = (name: string, side: 'top' | 'bottom', height: number) => h(PdfView, { style: { float: side, height } }, () => [h(PdfText, null, () => [`${name} `, h(PdfFootnote, () => `Note ${name}`)])])
    expect(await placesOf(() => [...lines(1, 1), noted('Low', 'bottom', 20), ...lines(2, 2), noted('Big', 'top', 300), ...lines(4, 30)], ['Low', 'Note Low', 'Big', 'Note Big'])).toEqual({
      // Big fits page 1 only without its note: it waits, and Low with its note keeps page 1.
      'Low': [1, 20, 366.8],
      'Note Low': [1, 26, 397.8],
      'Big': [2, 20, 29.6],
      'Note Big': [2, 26, 397.8],
    })
  })

  it('fails a float higher than the page has room for', async () => {
    await expect(render(() => [h(PdfText, { fixed: true }, () => 'Head'), figure('Huge', 'top', 375)])).rejects.toMatchObject({
      code: PDF_ERROR_CODES.LayoutError,
      // 379.5 pt of content less the 11 pt head.
      message: 'A <PdfView> with float "top" is 375 pt high, but its page has 368.53 pt for content. A float does not split: make it lower, or remove float so it breaks with the flow.',
    })
  })
})

describe('floats in columns', () => {
  const columns = (children: () => VNodeChild) => h(PdfView, { style: { columns: 2, columnGap: 10 } }, children)

  // Catches a float placed at the page top across the columns, or in a column before its anchor's.
  it('places a float at the top of the column that holds its anchor', async () => {
    expect(await placesOf(() => [columns(() => [...lines(1, 40), figure('Figure', 'top', 40), ...lines(41, 10)])], ['Line 1', 'Figure', 'Line 41'])).toEqual({
      // The anchor after Line 40 is in column 2, which starts with Line 28 below the figure.
      'Line 1': [1, 20, 29],
      'Figure': [1, 154, 29],
      'Line 41': [1, 154, 212],
    })
  })

  // Catches a section that the float splits into two outline entries or two boxes with edges at the cut.
  it('lifts a float out of a section, which keeps one bookmark with the float\'s nested in source order', async () => {
    const { pdf } = await render(() => [columns(() => [
      h(PdfView, { bookmark: 'Section', style: { borderWidth: 1, padding: 4 } }, () => [
        ...lines(1, 2),
        figure('Figure', 'top', 40, { bookmark: 'Figure' }),
        ...lines(13, 8),
        h(PdfText, { bookmark: 'Last' }, () => 'Last'),
      ]),
    ])])
    // The figure prints first, above Line 1: its entry still goes under the section's.
    expect(pdf.outline).toEqual([{ title: 'Section', expanded: false, children: [{ title: 'Figure', children: [] }, { title: 'Last', children: [] }] }])
  })

  // Catches a balanced part whose bottom float sits at the area end instead of the bottom of the balanced columns.
  it('places a bottom float at the bottom of the balanced columns', async () => {
    expect(await placesOf(() => [columns(() => [...lines(1, 10), figure('Bottom', 'bottom', 30), ...lines(11, 10)]), h(PdfText, null, () => 'After')], ['Line 1', 'Bottom', 'After'])).toEqual({
      // Its anchor misses column 1 at the balanced height; it ends at 149 pt, where the columns end.
      'Line 1': [1, 20, 29],
      'Bottom': [1, 154, 128],
      'After': [1, 20, 158],
    })
  })
})

describe('floats across all columns', () => {
  const columns = (children: () => VNodeChild, style: Record<string, unknown> = {}) => h(PdfView, { style: { columns: 2, columnGap: 10, ...style } }, children)
  /** A float with columnSpan "all": its area is its column container's part on the page. */
  const wide = (name: string, side: 'top' | 'bottom', height = 40) =>
    h(PdfView, { style: { float: side, columnSpan: 'all', height, backgroundColor: '#dddddd' } }, () => [h(PdfText, null, () => name)])
  const after = () => h(PdfText, null, () => 'After')

  // Catches a spanning float left in the flow between two column segments, or placed in one column.
  it.each<[string, () => VNodeChild, string[], Record<string, unknown>]>([
    // The anchor after Line 40 is on page 1: the float goes above both columns, which start below it.
    ['at the top of the container\'s part on the page', () => [columns(() => [...lines(1, 40), wide('Wide', 'top'), ...lines(41, 30)])], ['Wide', 'Line 1', 'Line 31', 'Line 41'], { 'Wide': [1, 20, 29], 'Line 1': [1, 20, 69], 'Line 31': [1, 154, 69], 'Line 41': [1, 154, 179] }],
    // The container goes on to page 2: its part on page 1 ends at the content end, 399.5 pt.
    ['at the bottom of a part that goes on', () => [columns(() => [...lines(1, 40), wide('Wide', 'bottom'), ...lines(41, 60)])], ['Wide'], { Wide: [1, 20, 368.5] }],
    // The part ends here: the float goes right below the balanced columns, and the text after the container below it.
    ['at the bottom of a balanced part', () => [columns(() => [...lines(1, 10), wide('Wide', 'bottom'), ...lines(11, 10)]), after()], ['Line 10', 'Line 20', 'Wide', 'After'], { 'Line 10': [1, 20, 128], 'Line 20': [1, 154, 128], 'Wide': [1, 20, 139], 'After': [1, 20, 179] }],
    // The 300 pt child across all columns does not fit below them, so the container goes on: its part on page 1 ends at the content end.
    ['at the content end when the part ends with balanced columns but goes on', () => [columns(() => [...lines(1, 10), wide('Wide', 'bottom'), ...lines(11, 10), h(PdfView, { style: { columnSpan: 'all', height: 300 } }, () => [h(PdfText, null, () => 'Span')]), ...lines(21, 4)])], ['Line 20', 'Wide', 'Span'], { 'Line 20': [1, 154, 128], 'Wide': [1, 20, 368.5], 'Span': [2, 20, 29] }],
    // The second float waits for page 2, so the container goes on: the first ends at the content end, not below the
    // columns. On page 2 the part holds no flow, so the second sits at its top.
    ['at the content end when only a float waits for the next page', () => [columns(() => [...lines(1, 10), wide('Low', 'bottom', 200), wide('Big', 'bottom', 200)])], ['Low', 'Big'], { Low: [1, 20, 208.5], Big: [2, 20, 29] }],
    // The container starts below Before, at 31 pt: that is its top, not the page top.
    ['at the top of a container that starts mid-page', () => [h(PdfText, null, () => 'Before'), columns(() => [...lines(1, 10), wide('Wide', 'top'), ...lines(11, 10)]), after()], ['Before', 'Wide', 'Line 1', 'After'], { 'Before': [1, 20, 29], 'Wide': [1, 20, 40], 'Line 1': [1, 20, 80], 'After': [1, 20, 190] }],
    // A height of 200 pt ends the container at 220 pt: the float ends there, not below the balanced columns.
    ['at the bottom of a container with a height', () => [columns(() => [...lines(1, 10), wide('Wide', 'bottom'), ...lines(11, 10)], { height: 200 }), after()], ['Line 20', 'Wide', 'After'], { 'Line 20': [1, 154, 128], 'Wide': [1, 20, 189], 'After': [1, 20, 229] }],
    // With maxHeight alone the container is as high as its content.
    ['right below the columns of a container with a maxHeight', () => [columns(() => [...lines(1, 10), wide('Wide', 'bottom'), ...lines(11, 10)], { maxHeight: 300 }), after()], ['Wide', 'After'], { Wide: [1, 20, 139], After: [1, 20, 179] }],
    // A plain child across all columns is split at its float, which goes to the container's top, 5 pt in as in the child.
    ['at the top when it floats out of a plain child across all columns', () => [columns(() => [...lines(1, 5), h(PdfView, { style: { columnSpan: 'all', borderWidth: 1, padding: 4 } }, () => [h(PdfText, null, () => 'Head'), figure('Wide', 'top', 40), h(PdfText, null, () => 'Tail')]), ...lines(6, 10)])], ['Wide', 'Line 1'], { 'Wide': [1, 25, 29], 'Line 1': [1, 20, 69] }],
    // Page 1 holds Lines 1 to 68, so the anchor after Line 80 is on page 2, and the columns run on to page 3.
    ['on the page of an anchor the columns of the page before do not reach', () => [columns(() => [...lines(1, 80), wide('Wide', 'top'), ...lines(81, 100)])], ['Wide', 'Line 68', 'Line 81', 'Line 180'], { 'Wide': [2, 20, 29], 'Line 68': [1, 154, 392], 'Line 81': [2, 20, 201], 'Line 180': [3, 154, 304] }],
    // Two 200 pt floats do not fit one page together: the second waits for page 2, and the text after it flows on.
    ['on the next page when the first takes the room', () => [columns(() => [...lines(1, 5), wide('W1', 'top', 200), ...lines(6, 5), wide('W2', 'top', 200), ...lines(11, 60)])], ['W1', 'W2', 'Line 11'], { 'W1': [1, 20, 29], 'W2': [2, 20, 29], 'Line 11': [1, 20, 339] }],
    // A page with columns is the container: its floats across all columns go to the page top.
    ['at the top of a page with columns', () => [...lines(1, 40), wide('Wide', 'top'), ...lines(41, 30)], ['Wide', 'Line 1', 'Line 31'], { 'Wide': [1, 20, 29], 'Line 1': [1, 20, 69], 'Line 31': [1, 154, 69] }],
  ])('places a float across all columns %s', async (name, children, names, expected) => {
    expect(await placesOf(children, names, name.endsWith('page with columns') ? { style: { columns: 2, columnGap: 10 } } : undefined)).toEqual(expected)
  })

  // Catches a spanning float that overtakes a column float of its side written before it, or falls behind one written after it.
  it.each<[string, () => VNodeChild, Record<string, unknown>]>([
    // Top: the spanning floats come first on a page, so one written after a placed column float waits for page 2.
    ['a top float in a column before it', () => [columns(() => [...lines(1, 5), figure('Col', 'top', 40), ...lines(6, 10), wide('Wide', 'top'), ...lines(16, 60)])], { Col: [1, 20, 29], Wide: [2, 20, 29] }],
    // The 300 pt column float waits for page 2, where nothing else is left: the container fits there whole, but the
    // spanning float written after it still waits, for page 3.
    ['a top float in a column before it that waits for the next page', () => [columns(() => [...lines(1, 60), figure('Col', 'top', 300), ...lines(61, 2), wide('Wide', 'top', 20), ...lines(63, 2)])], { Col: [2, 20, 29], Wide: [3, 20, 29] }],
    ['a top float in a column after it', () => [columns(() => [...lines(1, 5), wide('Wide', 'top'), ...lines(6, 10), figure('Col', 'top', 40), ...lines(16, 60)])], { Wide: [1, 20, 29], Col: [1, 20, 69] }],
    // Bottom: the column floats come first, so a column float written after a placed spanning float waits for page 2,
    // where it goes to the bottom of the balanced columns.
    ['a bottom float in a column after it', () => [columns(() => [...lines(1, 5), wide('Wide', 'bottom'), ...lines(6, 10), figure('Col', 'bottom', 40), ...lines(16, 60)])], { Wide: [1, 20, 368.5], Col: [2, 20, 95] }],
    // The 300 pt column float does not fit column 2 of page 1 with its anchor: the 12 pt one after it waits too, and prints below it.
    ['a bottom float in a column before it that waits for the next page', () => [columns(() => [...lines(1, 60), figure('Col', 'bottom', 300), ...lines(61, 1), wide('Wide', 'bottom', 12), ...lines(62, 60)])], { Col: [2, 20, 96.5], Wide: [2, 20, 396.5] }],
    ['a bottom float in a column before it', () => [columns(() => [...lines(1, 5), figure('Col', 'bottom', 40), ...lines(6, 10), wide('Wide', 'bottom'), ...lines(16, 60)])], { Col: [1, 20, 328.5], Wide: [1, 20, 368.5] }],
  ])('keeps source order with %s', async (_name, children, expected) => {
    expect(await placesOf(children, Object.keys(expected))).toEqual(expected)
  })

  // Catches a float checked against the page when its container's height gives it less room.
  it('fails a float higher than its container with a height has room for', async () => {
    await expect(render(() => [columns(() => [...lines(1, 4), wide('Huge', 'top', 250)], { height: 200 })])).rejects.toMatchObject({
      code: PDF_ERROR_CODES.LayoutError,
      message: 'A <PdfView> with float "top" is 250 pt high, but its column container has 200 pt for content. A float does not split: make it lower, or remove float so it breaks with the flow.',
    })
  })

  // Catches content that overflows a container's height below its floats, drawn over the text after it.
  it('fails a container with a height whose content and floats need more than its columns hold', async () => {
    await expect(render(() => [columns(() => [...lines(1, 30), wide('Wide', 'bottom'), ...lines(31, 6)], { height: 200 }), after()])).rejects.toMatchObject({
      code: PDF_ERROR_CODES.LayoutError,
      message: 'A view with columns and a height or maxHeight holds 396 pt of content, more than its 2 columns of 160 pt hold. Remove height and maxHeight from the view, or make its content lower.',
    })
  })
})

describe('floats out of padded views', () => {
  // Catches a float that the builder lays out at its parent's full width once it leaves the parent's padding.
  it('keeps the width and the left edge it had in its parent', async () => {
    expect(await placesOf(() => [h(PdfView, { style: { padding: 10, borderWidth: 1 } }, () => [...lines(1, 3), figure('Low', 'bottom', 40), ...lines(4, 3)])], ['Line 1', 'Low'])).toEqual({
      'Line 1': [1, 31, 40],
      'Low': [1, 31, 368.5],
    })
  })
})

describe('floats at mount', () => {
  it.each<[string, () => VNodeChild, string]>([
    ['on a text', () => h(PdfText, { style: { float: 'top' } }, () => 'Caption'), '<PdfText> cannot have float "top": only a <PdfView>, <PdfImage>, <PdfSvg> or <PdfTable> floats. Put the content into a <PdfView> with float.'],
    ['in a row', () => h(PdfView, { style: { flexDirection: 'row' } }, () => figure('F', 'top')), '<PdfView> cannot have float "top" inside <PdfView> with flexDirection "row": a float reaches the top or the bottom of its column or page only through plain views: column direction, no height, minHeight, maxHeight, flexGrow or justifyContent, not fixed or absolute, not a link, a table or wrap={false}. Move the float out, or make the views around it plain.'],
    ['in a view with a height', () => h(PdfView, { style: { height: 200 } }, () => figure('F', 'top')), '<PdfView> cannot have float "top" inside <PdfView> with height: a float reaches the top or the bottom of its column or page only through plain views: column direction, no height, minHeight, maxHeight, flexGrow or justifyContent, not fixed or absolute, not a link, a table or wrap={false}. Move the float out, or make the views around it plain.'],
    ['in a link', () => h(PdfLink, { href: 'https://example.test' }, () => figure('F', 'top')), '<PdfView> cannot have float "top" inside <PdfLink>: a float reaches the top or the bottom of its column or page only through plain views: column direction, no height, minHeight, maxHeight, flexGrow or justifyContent, not fixed or absolute, not a link, a table or wrap={false}. Move the float out, or make the views around it plain.'],
    ['in a table cell', () => h(PdfTable, { columns: [1] }, () => h(PdfTableRow, () => h(PdfTableCell, () => figure('F', 'top')))), '<PdfView> cannot have float "top" inside <PdfTable>: a float reaches the top or the bottom of its column or page only through plain views: column direction, no height, minHeight, maxHeight, flexGrow or justifyContent, not fixed or absolute, not a link, a table or wrap={false}. Move the float out, or make the views around it plain.'],
    ['in a fixed node', () => h(PdfView, { fixed: true }, () => figure('F', 'top')), '<PdfView> cannot have float "top" inside <PdfView>, a fixed or absolute node: a float reaches the top or the bottom of its column or page only through plain views: column direction, no height, minHeight, maxHeight, flexGrow or justifyContent, not fixed or absolute, not a link, a table or wrap={false}. Move the float out, or make the views around it plain.'],
    ['in a float', () => h(PdfView, { style: { float: 'top' } }, () => figure('F', 'bottom')), '<PdfView> cannot have float "bottom" inside <PdfView>, which floats itself: a float is placed whole, so a float inside it has no column or page to go to. Remove one of the two floats.'],
    ['with a break', () => h(PdfView, { break: true, style: { float: 'top' } }, () => h(PdfText, () => 'F')), '<PdfView> cannot have float "top" together with "break": a float leaves the flow, so the flow\'s page breaks and keeps do not apply to it. Remove "break", or put it on the node next to the float.'],
    ['with columns', () => h(PdfView, { style: { float: 'top', columns: 2 } }, () => h(PdfText, () => 'F')), '<PdfView> cannot have float "top": it has columns, and a float does not split, so its columns would never fill over pages. Remove the columns, or remove float.'],
  ])('rejects a float %s', async (_name, children, message) => {
    await expect(mountPdfComponent(documentOf(children))).rejects.toMatchObject({ code: PDF_ERROR_CODES.TreeInvalid, message })
  })

  it.each<[string, Record<string, unknown>, string]>([
    ['wrap={false}', { wrap: false }, '<PdfView> cannot have float "top" on <PdfPage> with wrap={false}: that page does not break into pages, so it has no page top or bottom to float to. Remove float, or remove wrap={false} from the page.'],
    ['justifyContent', { style: { justifyContent: 'center' } }, '<PdfView> cannot have float "top" on <PdfPage> with justifyContent "center": the page would move its floats away from its top and bottom. Remove float, or remove justifyContent from the page.'],
  ])('rejects a float on a page with %s', async (_name, pageProps, message) => {
    await expect(mountPdfComponent(documentOf(() => figure('F', 'top'), pageProps))).rejects.toMatchObject({ code: PDF_ERROR_CODES.TreeInvalid, message })
  })
})

describe('floats and passes', () => {
  // A page reference whose digits wrap its line moves the float after it to
  // the next page: pass 1 prints one digit and places the float on page 10,
  // pass 2 prints "10" in two lines and the float goes to page 11, pass 3
  // settles. Floats add no pass and no fact, so the pass cap of the page
  // references ends such a case: catches a float that a pass places from
  // stale facts, or a loop past the cap.
  const document = () => [
    ...Array.from({ length: 9 }, (_, page) => h(PdfText, { break: page > 0 }, () => `Filler ${page + 1}`)),
    h(PdfText, { break: true, style: { width: 78 } }, () => ['Figure on page ', h(PdfPageRef, { to: 'figure' })]),
    ...lines(1, 24),
    h(PdfView, { id: 'figure', style: { float: 'top', height: 100 } }, () => [h(PdfText, null, () => 'Figure')]),
    ...lines(25, 20),
  ]

  it('settles a page reference that moves a float, and ends at the pass cap with a typed error', async () => {
    const { result, pdf } = await render(document)
    expect(result.passes).toBe(3)
    expect(pdf.pages.findIndex(page => page.textRuns.some(run => run.text === 'Figure')) + 1).toBe(11)
    await expect(render(document, { maxPasses: 2 })).rejects.toMatchObject({
      code: PDF_ERROR_CODES.LimitExceeded,
      message: expect.stringContaining('did not stabilize after 2 layout passes'),
    })
  })
})
