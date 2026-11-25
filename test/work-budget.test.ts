import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Component } from 'vue'
import { createPdfTemplate, type PdfTemplateRuntimeOptions } from '../src/runtime/server/registry'
import { countedWork } from '../src/runtime/server/engine/work'
import { createPdfFontStore, fontStoreOf } from '../src/runtime/server/engine/fonts'
import { layoutParagraphs, measureParagraphs } from '../src/runtime/server/engine/text'
import { pdfRenderPlacement } from '../src/runtime/server/worker-pool'
import type { ElementNode } from '../src/runtime/server/engine/layout/types'
import { PDF_PRIMITIVES } from '../src/runtime/primitives'
import { renderDocument } from './engine-render'
import { flowLine, named, noteBody, noteDocument } from './fixtures/footnotes'
import { hundredPages, invoice, keepingTable, longTable, minHeightStack, multiPassReport, realInvoice, realInvoiceAuto, realInvoiceOptions, realInvoiceSpans, terms, termsColumns, termsColumnsNotes } from './fixtures/performance/workloads'

// The speed budget as counted work (internals/performance.md): exact numbers,
// the same on every machine, so the test never flakes. A change that adds a
// layout pass, lays pages out again, shapes text twice or embeds a font or an
// image twice changes a number here; if the change is intended, the new
// number goes in with the reason. `wordsHyphenated` is 0 in every row: the
// counted render finds each word in the cache the first render filled.

const placement = pdfRenderPlacement.inProcess
beforeAll(() => {
  // A render pool worker counts in its own thread.
  pdfRenderPlacement.inProcess = true
})
afterAll(() => {
  pdfRenderPlacement.inProcess = placement
})

const work = async (key: string, component: Component, props: object = {}, options: PdfTemplateRuntimeOptions = {}) => {
  const template = createPdfTemplate<object>(key, component, options)
  // A first render loads the fonts; the second is the one counted.
  await template.render(props)
  const { result: { diagnostics }, work } = await countedWork(() => template.render(props))
  return { pages: diagnostics.pageCount, passes: diagnostics.passes, ...work }
}

describe('work budget', () => {
  it.each<[string, () => ReturnType<typeof work>, Awaited<ReturnType<typeof work>>]>([
    ['the one-page invoice', () => work('budget-invoice', invoice, { token: 'budget' }), { pages: 1, passes: 1, layouts: 1, pagesLaidOut: 1, pageRelayouts: 1, nodesLaidOut: 84, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 0, columnFills: 0, columnBalanceTries: 0, noteFits: 0, floatFills: 0, runsShaped: 41, fontsEmbedded: 0, imagesEmbedded: 0, wordsHyphenated: 0 }],
    ['100 explicit pages', () => work('budget-100-pages', hundredPages), { pages: 100, passes: 1, layouts: 1, pagesLaidOut: 100, pageRelayouts: 100, nodesLaidOut: 400, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 0, columnFills: 0, columnBalanceTries: 0, noteFits: 0, floatFills: 0, runsShaped: 100, fontsEmbedded: 0, imagesEmbedded: 0, wordsHyphenated: 0 }],
    // The page builder (migration step 1, flow): each page laid out once, no
    // layout of a rest before its split. Today's path: 8 relayouts, 366 nodes.
    ['a page reference to a later page', () => work('budget-multi-pass', multiPassReport), { pages: 3, passes: 2, layouts: 2, pagesLaidOut: 6, pageRelayouts: 6, nodesLaidOut: 338, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 0, columnFills: 0, columnBalanceTries: 0, noteFits: 0, floatFills: 0, runsShaped: 164, fontsEmbedded: 0, imagesEmbedded: 0, wordsHyphenated: 0 }],
    // Before the cut of each rest: 9,986 nodes.
    // The page builder (step 7, a footer written after the flow): each page
    // laid out once and once more with its page count. Today's path: 21
    // relayouts and 6,452 nodes (5,741 with 'auto' columns, 6,829 with cells
    // over four rows), and 7 more shaped runs, the footer of each page laid
    // out before the count was known; the builder shapes it once in reserved
    // digits, and a "0". Without the page-number fix of step 7 (digits laid
    // out in the font's widest digit, here not "0"), the builder gave up after
    // its pages and today's path ran too: 29 relayouts.
    // A table cell is always a view; a cell with only text holds its text as
    // a child, one node more per such cell in each layout of the tables below
    // (4,503 nodes before here, 4,007 with 'auto' columns, 4,623 with spans,
    // 8,032 for the keeping table, 29,574 for the 49-page table).
    ['the real-shaped invoice', () => work('budget-real-invoice', realInvoice, {}, realInvoiceOptions), { pages: 7, passes: 1, layouts: 2, pagesLaidOut: 8, pageRelayouts: 14, nodesLaidOut: 6503, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 0, columnFills: 0, columnBalanceTries: 0, noteFits: 0, floatFills: 0, runsShaped: 391, fontsEmbedded: 3, imagesEmbedded: 1, wordsHyphenated: 0 }],
    // 'auto' columns measure each cell before yoga: no extra layout, page or
    // shaped run against the fixed columns above (D39, "Cost in the work
    // counters"). Fewer nodes: a measured cell takes its columns itself, while
    // the fixed table above keeps a view around each cell of its share column
    // (711 of them over all layouts).
    ['the real-shaped invoice with \'auto\' columns', () => work('budget-real-invoice-auto', realInvoiceAuto, {}, realInvoiceOptions), { pages: 7, passes: 1, layouts: 2, pagesLaidOut: 8, pageRelayouts: 14, nodesLaidOut: 6007, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 0, columnFills: 0, columnBalanceTries: 0, noteFits: 0, floatFills: 0, runsShaped: 391, fontsEmbedded: 3, imagesEmbedded: 1, wordsHyphenated: 0 }],
    // Cells over several rows (D39, "Layout"): the same pages, layouts and
    // shaped runs as the invoice above. One more yoga layout of the page tree
    // gives the 40 rate cells their heights; no row grows (each rate is one
    // line in four rows), and the relayouts of pagination find the heights in
    // the styles. More nodes: each rate cell sits in a view that takes its column.
    ['the real-shaped invoice with each rate over four rows', () => work('budget-real-invoice-spans', realInvoiceSpans, {}, realInvoiceOptions), { pages: 7, passes: 1, layouts: 2, pagesLaidOut: 8, pageRelayouts: 14, nodesLaidOut: 6263, rowSpanLayouts: 1, settleLayouts: 0, keepSteps: 0, columnFills: 0, columnBalanceTries: 0, noteFits: 0, floatFills: 0, runsShaped: 391, fontsEmbedded: 3, imagesEmbedded: 1, wordsHyphenated: 0 }],
    // Every row keeps with the next: the keep walk stops a page below each
    // row (endOfKeep), so it costs at most a page of steps (69 rows) per row
    // that pagination reads. Without that stop: 489,515 steps, same pages.
    // The page builder (step 6, rows): each page laid out once; its keep walk
    // reads 68 steps more over the 15 pages. Today's path: 29 relayouts,
    // 12,184 nodes, 63,341 steps.
    ['a 1,000-row table where every row keeps with the next', () => work('budget-keeping-table', keepingTable), { pages: 15, passes: 1, layouts: 1, pagesLaidOut: 15, pageRelayouts: 15, nodesLaidOut: 12032, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 64375, columnFills: 0, columnBalanceTries: 0, noteFits: 0, floatFills: 0, runsShaped: 2000, fontsEmbedded: 0, imagesEmbedded: 0, wordsHyphenated: 0 }],
    // Before the cut of each rest (layout/paginate/cut.ts): 270,053 nodes.
    // The page builder (step 7, a footer written after the flow): two
    // relayouts per page. Today's path: 147 relayouts, 41,104 nodes and 49
    // fewer shaped runs: a standard font shapes on every call, and the
    // builder shapes the footer three times per page (in reserved digits,
    // with the total, painted), today's path twice.
    ['the 49-page table', () => work('budget-long-table', longTable), { pages: 49, passes: 1, layouts: 2, pagesLaidOut: 50, pageRelayouts: 98, nodesLaidOut: 38094, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 0, columnFills: 0, columnBalanceTries: 0, noteFits: 0, floatFills: 0, runsShaped: 5634, fontsEmbedded: 0, imagesEmbedded: 0, wordsHyphenated: 0 }],
    // Finding (aq): the same view at two lengths, so the row shows linear
    // growth. Before the cut entered a view with a `minHeight` its content
    // passed, every rest laid out all of the view: 1,295 and 4,490 nodes.
    // The page builder lays each page out once: one relayout per page.
    // Today's path with the cut: 19 and 39 relayouts, 784 and 1,634 nodes.
    ['200 texts in a view with a minHeight', () => work('budget-min-height-200', minHeightStack, { count: 200 }), { pages: 10, passes: 1, layouts: 1, pagesLaidOut: 10, pageRelayouts: 10, nodesLaidOut: 422, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 0, columnFills: 0, columnBalanceTries: 0, noteFits: 0, floatFills: 0, runsShaped: 200, fontsEmbedded: 0, imagesEmbedded: 0, wordsHyphenated: 0 }],
    ['400 texts in a view with a minHeight', () => work('budget-min-height-400', minHeightStack, { count: 400 }), { pages: 20, passes: 1, layouts: 1, pagesLaidOut: 20, pageRelayouts: 20, nodesLaidOut: 842, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 0, columnFills: 0, columnBalanceTries: 0, noteFits: 0, floatFills: 0, runsShaped: 400, fontsEmbedded: 0, imagesEmbedded: 0, wordsHyphenated: 0 }],
    // The page builder: one relayout per page; its keep walk over the sums
    // takes about the steps of today's (113), with 17 relayouts and 856 nodes.
    ['general terms in one column', () => work('budget-terms', terms), { pages: 9, passes: 1, layouts: 1, pagesLaidOut: 9, pageRelayouts: 9, nodesLaidOut: 508, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 124, columnFills: 0, columnBalanceTries: 0, noteFits: 0, floatFills: 0, runsShaped: 364, fontsEmbedded: 0, imagesEmbedded: 0, wordsHyphenated: 0 }],
    // The page builder: one relayout per page, as in one column. A column is
    // filled like a page, by sums over the galley laid out once at the
    // column width (layout/columns), and nothing is laid out again. Fills
    // are arithmetic: per page, a probe in order (does the part end here?),
    // then the split's fill or the balance's tries; each fill walks its
    // keeps, so the keep steps add up over the probes. The balance takes 7
    // tries, as today's. Today's path: 30 relayouts, 1,247 nodes, 26 fills,
    // 137 keep steps.
    ['the same terms in two columns', () => work('budget-terms-columns', termsColumns), { pages: 7, passes: 1, layouts: 1, pagesLaidOut: 7, pageRelayouts: 7, nodesLaidOut: 551, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 236, columnFills: 54, columnBalanceTries: 7, noteFits: 0, floatFills: 0, runsShaped: 364, fontsEmbedded: 0, imagesEmbedded: 0, wordsHyphenated: 0 }],
    // The same with a footnote in every fifth clause title (24 notes), on the
    // page builder: one relayout per page. Each try of a page's fit is a fill
    // by sums, which fills and balances the columns again; 12 tries more than
    // one per page, as today's. The fills and keep steps add up over the
    // tries. Today's path: 63 relayouts, 2,269 nodes, 78 fills, 22 balance
    // tries, 432 keep steps.
    ['the same terms in two columns with footnotes', () => work('budget-terms-columns-notes', termsColumnsNotes), { pages: 7, passes: 1, layouts: 1, pagesLaidOut: 7, pageRelayouts: 7, nodesLaidOut: 618, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 752, columnFills: 170, columnBalanceTries: 24, noteFits: 12, floatFills: 0, runsShaped: 460, fontsEmbedded: 0, imagesEmbedded: 0, wordsHyphenated: 0 }],
  ])('%s', async (_name, render, expected) => {
    expect(await render()).toEqual(expected)
    // The counts are exact, but the 49-page table renders twice at over a
    // second each; on a loaded machine that passes the default 5 s.
  }, 60_000)

  // Counts that a render shared with the process would add the other
  // render's nodes to each: 484 for both.
  it('counts only its own work beside another render', async () => {
    const invoiceTemplate = createPdfTemplate<object>('budget-beside-invoice', invoice)
    const pagesTemplate = createPdfTemplate<object>('budget-beside-pages', hundredPages)
    await Promise.all([invoiceTemplate.render({ token: 'budget' }), pagesTemplate.render({})])
    const [first, second] = await Promise.all([
      countedWork(() => invoiceTemplate.render({ token: 'budget' })),
      countedWork(() => pagesTemplate.render({})),
    ])
    expect([first.work.nodesLaidOut, second.work.nodesLaidOut]).toEqual([84, 400])
  })

  // The footnote fit on the design's example (R1), an engine tree, on the
  // page builder: page 1 tries 5 fills (the page end; 80, where the notes of
  // what stays leave room; then up a line at a time, 90 and 100, to 110,
  // which fails), page 2 one. The bodies are laid out once, with the page;
  // each page is laid out once (today's path: 4 splits on page 1, 3 relayouts).
  it('footnotes whose fit needs the upward search', async () => {
    const flow = named('L', 12).map((text, at) => at === 7 ? flowLine(text, 'A') : at === 9 ? flowLine(text, 'B') : flowLine(text))
    await renderDocument(noteDocument(flow, [noteBody('A', named('a', 2)), noteBody('B', named('b', 6))]))
    const { work } = await countedWork(() => renderDocument(noteDocument(flow, [noteBody('A', named('a', 2)), noteBody('B', named('b', 6))])))
    expect(work).toEqual({ layouts: 1, pagesLaidOut: 2, pageRelayouts: 2, nodesLaidOut: 35, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 0, columnFills: 0, columnBalanceTries: 0, noteFits: 4, floatFills: 0, runsShaped: 22, fontsEmbedded: 0, imagesEmbedded: 0, wordsHyphenated: 0 })
  })

  // A forced page (rule 11): L1's notes do not fit beside it. The fit tries
  // phase 1's two heights (120, 30), then from the content top the first
  // fill that keeps a flow line (L1 at 20) and one step up (45), which fails;
  // the rest of the view goes to page 2. A search that went on to every
  // height would try each line end below L1 as well.
  it('a forced footnote page, whose search from the page top stops at the first line', async () => {
    const document = () => noteDocument([{ type: PDF_PRIMITIVES.View, box: {}, style: { paddingTop: 15, paddingBottom: 5 }, props: {}, children: [flowLine('L1', 'A', 'B'), ...named('L', 8).slice(1).map(text => flowLine(text))] } as ElementNode], [noteBody('A', named('a', 8)), noteBody('B', ['b1'])])
    await renderDocument(document())
    const { work } = await countedWork(() => renderDocument(document()))
    expect(work).toEqual({ layouts: 1, pagesLaidOut: 2, pageRelayouts: 2, nodesLaidOut: 31, rowSpanLayouts: 0, settleLayouts: 0, keepSteps: 0, columnFills: 0, columnBalanceTries: 0, noteFits: 3, floatFills: 0, runsShaped: 19, fontsEmbedded: 0, imagesEmbedded: 0, wordsHyphenated: 0 })
  })
})

describe('the shaping cache', () => {
  // Every caller of one string gets the same run (fonts.ts), so a layout step
  // that changed it instead of a copy would change the text of other lines.
  it('hands each caller the same run, frozen down to its positions', async () => {
    const source = fontStoreOf(createPdfFontStore(realInvoiceOptions.fonts)).getFont({ fontFamily: 'Inter', fontWeight: 400 })
    await source.load()
    const font = source.data
    if (font === null || font.type !== 'TTF') throw new Error('Inter did not load as a fontkit font')
    const shape = () => font.layout('EUR 120.00', undefined, undefined, undefined, 'ltr')
    const run = shape()
    expect(shape()).toBe(run)
    expect(() => {
      // The type is read-only; the test proves the object is too.
      ;(run.positions[0] as { xAdvance: number }).xAdvance = 0
    }).toThrow(TypeError)
    expect([run, run.glyphs, run.positions].every(part => Object.isFrozen(part))).toBe(true)
  })

  // Automatic table columns measure each cell before it is laid out
  // (measureParagraphs); measured runs that differed from the laid-out ones
  // would shape every cell twice.
  it('lays out a measured text without shaping it again', async () => {
    const source = fontStoreOf(createPdfFontStore(realInvoiceOptions.fonts)).getFont({ fontFamily: 'Inter', fontWeight: 400 })
    await source.load()
    const font = source.data!
    const fragments = [{ string: 'Consulting services for the second quarter', style: { fonts: [font], fontSize: 10, color: 'black', underline: false, strike: false, underlineColor: 'black', strikeColor: 'black' } }]
    const measured = await countedWork(async () => measureParagraphs(fragments, { hyphenate: true }))
    const laidOut = await countedWork(async () => layoutParagraphs(fragments, { x: 0, y: 0, width: 80, height: Infinity }, { hyphenate: true }))
    expect([measured.work.runsShaped, laidOut.work.runsShaped]).toEqual([1, 0])
  })
})
