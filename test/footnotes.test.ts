import { describe, expect, it } from 'vitest'
import type { DocumentNode, ElementNode, LaidOutNode } from '../src/runtime/server/engine/layout/types'
import { PDF_PRIMITIVES } from '../src/runtime/primitives'
import { createRenderLimits, DEFAULT_PDF_RENDER_LIMITS } from '../src/runtime/server/render-limits'
import { parsePdf, type ParsedPdf } from '../src/test/pdf'
import { renderDocument } from './engine-render'
import { flowLine, named, noteBody, noteDocument } from './fixtures/footnotes'

// The footnote fit on engine trees built by hand, in the shape the plain
// tree hands over (page `notes` and `noteArea`). Every page: 200 × 140 pt, 20 pt padding,
// 10 pt lines, so the flow has 10 lines from top 20 to 120 (the wrap area);
// a line whose box starts at y prints its run at y − 1.5 (Helvetica's glyph
// box is 11 pt, so the half-leading of a 10 pt line is −0.5). With an area
// of no style (the fixture's default) no rule or gap adds to the notes.

const render = async (document: DocumentNode) => {
  // A pagination that does not end fails here, not in a hung run.
  let pages = 0
  document.onPage = () => {
    if (++pages > 40) throw new Error('Pagination made more than 40 pages.')
  }
  const { bytes, layout } = await renderDocument(document, { limits: createRenderLimits({ ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: 10_000 }) })
  return { parsed: await parsePdf(bytes), layout }
}

/** Every text run but the marks and the blanks text extraction adds between cells, as "page text top" (top from the page top), and ` x${x}` for a run that does not start at x 20. */
const placesOf = (parsed: ParsedPdf) => parsed.pages.flatMap(page => page.textRuns
  .filter(run => run.text.trim() !== '' && !/^[A-Z]+$/.test(run.text))
  .map((run) => {
    const x = Math.round(run.x * 100) / 100
    return `${page.number} ${run.text} ${Math.round((page.height - run.y - run.height) * 100) / 100}${x === 20 ? '' : ` x${x}`}`
  }))

/** An area's box `[top, left, width, height]` and its children's tops in it. */
const boxesOf = (area: LaidOutNode) =>
  [[area.box.top, area.box.left, area.box.width, area.box.height], (area.children as LaidOutNode[]).map(child => child.box.top)]

const view = (style: Record<string, unknown>, children: ElementNode[], props: Record<string, unknown> = {}): ElementNode =>
  ({ type: PDF_PRIMITIVES.View, box: {}, style, props, children } as ElementNode)

/** Flow lines `L${from}` to `L${to}`, each with a mark to the note named in `refs` at its number. */
const lines = (from: number, to: number, refs: Record<number, string> = {}): ElementNode[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index).map(at => refs[at] === undefined ? flowLine(`L${at}`) : flowLine(`L${at}`, refs[at]!))

/** The places of `texts` on `page`, one line per 10 pt from the run top `top`. */
const column = (page: number, texts: readonly string[], top: number): string[] => texts.map((text, at) => `${page} ${text} ${top + 10 * at}`)

describe('the footnote fit', () => {
  // The design's example (R1): a reference in line 8 (note A, 2 lines) and
  // in line 10 (note B, 6 lines whose start is 2). The first split needs 14
  // lines, the second keeps 6; the upward search finds that 8 lines and note
  // A fit. Catches a fit without phase 2 (the page keeps 6 lines: L7 on
  // page 2). Line 12 refers to A again: catches a second body.
  it('keeps as many lines as fit with the notes of their references (the R1 example)', async () => {
    const { parsed } = await render(noteDocument(lines(1, 12, { 8: 'A', 10: 'B', 12: 'A' }), [noteBody('A', named('a', 2)), noteBody('B', named('b', 6))]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('L', 8), 18.5),
      ...column(1, ['a1', 'a2'], 98.5),
      ...column(2, ['L9', 'L10', 'L11', 'L12'], 18.5),
      ...column(2, named('b', 6), 58.5),
    ])
  })

  // Line 8 has a 5 pt bottom margin: it stays at any split height from its
  // box bottom (100) on, so the part ends at 100 and note A fits below; the
  // break drops the margin. Catches a part measured to the split height (7
  // lines on page 1) or with the margin.
  it('keeps a line whose bottom margin crosses the room above the notes', async () => {
    const flow = lines(1, 12, { 8: 'A', 10: 'B' })
    flow[7] = { ...flow[7]!, style: { marginBottom: 5 } }
    const { parsed } = await render(noteDocument(flow, [noteBody('A', named('a', 2)), noteBody('B', named('b', 6))]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('L', 8), 18.5),
      ...column(1, ['a1', 'a2'], 98.5),
      ...column(2, ['L9', 'L10', 'L11', 'L12'], 18.5),
      ...column(2, named('b', 6), 58.5),
    ])
  })

  // The last page: line 6 refers to A and has a 30 pt bottom margin. The
  // split height is the page end, where the margin (70 to 100 + 30) ends
  // above it, so the split keeps it, and it reaches into the area (100 to
  // 120). Catches a flow whose room ends at the area top: the six lines
  // shrink to make room for the margin (8.33 pt apart).
  it('keeps the lines of a last page whose last margin reaches into the note area', async () => {
    const flow = lines(1, 6, { 6: 'A' })
    flow[5] = { ...flow[5]!, style: { marginBottom: 30 } }
    const { parsed } = await render(noteDocument(flow, [noteBody('A', named('a', 2))]))
    expect(placesOf(parsed)).toEqual([...column(1, named('L', 6), 18.5), ...column(1, ['a1', 'a2'], 98.5)])
  })

  // The same line with a 25 pt bottom margin, which ends below the page end
  // (125) at every split height: its box fits above note A, so it stays and
  // loses the margin (D25). Catches the line moved to page 2 for its own
  // margin (L8 there, page 1 with 7 lines).
  it('keeps a line whose bottom margin crosses the page end above the notes', async () => {
    const flow = lines(1, 12, { 8: 'A', 10: 'B' })
    flow[7] = { ...flow[7]!, style: { marginBottom: 25 } }
    const { parsed } = await render(noteDocument(flow, [noteBody('A', named('a', 2)), noteBody('B', named('b', 6))]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('L', 8), 18.5),
      ...column(1, ['a1', 'a2'], 98.5),
      ...column(2, ['L9', 'L10', 'L11', 'L12'], 18.5),
      ...column(2, named('b', 6), 58.5),
    ])
  })

  // Line 10 refers to a note of 8 lines: its start (2 lines, the orphans)
  // does not fit below line 10, so line 10 moves to page 2 with it (rule 3).
  // There the note gets the room left, cut so 2 lines (the widows) go on;
  // they fill page 3 alone. Catches a fit that ignores the start of the
  // last note (L10 stays on page 1 with no note), a cut without widows
  // (d7 on page 2) and a page loop that ends with a note part left (no d7).
  it('moves a reference line with the start of its note, and the note continues', async () => {
    const { parsed } = await render(noteDocument(lines(1, 12, { 10: 'D' }), [noteBody('D', named('d', 8))]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('L', 9), 18.5),
      ...column(2, ['L10', 'L11', 'L12'], 18.5),
      ...column(2, named('d', 6), 58.5),
      ...column(3, ['d7', 'd8'], 98.5),
    ])
  })

  // Note E (8 lines) from line 5: page 1 keeps 8 lines and 2 note lines;
  // the 6 others go first on page 2, before note F of line 11, and take
  // their room from the flow there (L12 to page 3). Catches the carried
  // part placed after the page's own notes (f1 above e3), a carried part
  // not counted in the room (L12 on page 2, the notes past the page end),
  // and a last note counted whole (page 1 keeps 4 lines). F comes first in
  // the page's notes, so E is laid out 10 pt down among them: catches a cut
  // of E that reads that top.
  it('puts the carried part of a note first on the next page', async () => {
    const { parsed } = await render(noteDocument(lines(1, 12, { 5: 'E', 11: 'F' }), [noteBody('F', ['f1']), noteBody('E', named('e', 8))]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('L', 8), 18.5),
      ...column(1, ['e1', 'e2'], 98.5),
      ...column(2, ['L9', 'L10', 'L11'], 18.5),
      ...column(2, ['e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'f1'], 48.5),
      ...column(3, ['L12'], 18.5),
    ])
  })

  // The area box: a 4 pt top margin, a 0.5 pt rule (its top border), 3 pt
  // under the rule, 0.5 pt at its bottom, a 2 pt gap between notes, and a
  // 6 pt font the notes inherit (6 pt lines). Lines 7, 8 and 9 refer to H, K
  // and M (1 line each). With line 8, the notes need 8 + 6 + 2 + 6 = 22 below
  // 100: 2 too much (the gap), so line 8 moves. Page 2 holds K and M, 2 pt
  // apart.
  // Catches a fit that leaves the area's own height (also its bottom edge)
  // or the gap out, notes laid out with the page as their style parent
  // (10 pt lines), an area placed at its margin's top instead of below it,
  // and notes laid out without the gap.
  it('lays the notes out in the area box: rule, margin, padding, gap and its text styles', async () => {
    const area = { marginTop: 4, borderTopWidth: 0.5, borderTopColor: 'black', paddingTop: 3, paddingBottom: 0.5, gap: 2, fontSize: 6 }
    const { parsed, layout } = await render(noteDocument(lines(1, 12, { 7: 'H', 8: 'K', 9: 'M' }), [noteBody('H', ['h1']), noteBody('K', ['k1']), noteBody('M', ['m1'])], area))
    expect(placesOf(parsed).filter(place => / L\d+ /.test(place))).toEqual([
      ...column(1, named('L', 7), 18.5),
      ...column(2, ['L8', 'L9', 'L10', 'L11', 'L12'], 18.5),
    ])
    // Page 1: 14 high with its margin, so its box starts at 120 − 14 + 4 and
    // ends at the bottom padding (120).
    expect([0, 1].map(page => boxesOf(layout.children[page]!.children.at(-1) as LaidOutNode))).toEqual([
      [[110, 20, 160, 10], [3.5]],
      [[102, 20, 160, 18], [3.5, 11.5]],
    ])
  })

  // The area's own children come first on every page part: a 40 pt wide,
  // 3 pt high view (a short rule) with margins of 1 and 4 pt, as the
  // feature's rule has, then a 2 pt gap, then the notes. Lines 5 and 11
  // refer to H and K. The area needs 1 + 3 + 4 + 2 + 10 = 20 pt, all that is
  // left under line 8, so it starts at 100 on both pages. Catches a fit
  // without the area's own children (9 lines on page 1, the note past the
  // bottom padding), one without the child's bottom margin (the area at
  // 104, past the padding) and an area that drops them on a page part.
  it('puts the area\'s own children first on every page part and counts them', async () => {
    const rule = { type: PDF_PRIMITIVES.View, box: {}, style: { width: 40, height: 3, marginTop: 1, marginBottom: 4, backgroundColor: 'black' }, props: {}, children: [] } as unknown as ElementNode
    const document = noteDocument(lines(1, 12, { 5: 'H', 11: 'K' }), [noteBody('H', ['h1']), noteBody('K', ['k1'])], { gap: 2 })
    document.children[0]!.noteArea!.children = [rule]
    const { parsed, layout } = await render(document)
    expect(placesOf(parsed)).toEqual([...column(1, named('L', 8), 18.5), '1 h1 108.5', ...column(2, ['L9', 'L10', 'L11', 'L12'], 18.5), '2 k1 108.5'])
    const areas = [0, 1].map(page => layout.children[page]!.children.at(-1) as LaidOutNode)
    expect(areas.map(boxesOf)).toEqual([[[100, 20, 160, 20], [1, 10]], [[100, 20, 160, 20], [1, 10]]])
    expect(areas.map(area => [(area.children[0] as LaidOutNode).box.width, (area.children[0] as LaidOutNode).box.height])).toEqual([[40, 3], [40, 3]])
  })

  // Rule 11: line 1 refers to a note of 35 lines whose start (12 orphans)
  // never fits below it. Page 1 keeps line 1 and the 9 note lines that fit;
  // pages 2 and 3 hold only note lines (a carried part higher than the
  // page); page 4 the last 6 and the rest of the flow. Catches a page top
  // that places nothing (pagination never ends), a cut that keeps the
  // orphans instead of what fits, and a page loop that counts a page of
  // note lines as taking nothing ("Pagination cannot end" at page 3).
  it('ends when a note never fits: each page places a flow line or a note line', async () => {
    const { parsed } = await render(noteDocument(lines(1, 3, { 1: 'G' }), [noteBody('G', named('g', 35), { orphans: 12 })]))
    expect(placesOf(parsed)).toEqual([
      '1 L1 18.5',
      ...column(1, named('g', 9), 28.5),
      ...column(2, named('g', 19).slice(9), 18.5),
      ...column(3, named('g', 29).slice(19), 18.5),
      ...column(4, ['L2', 'L3'], 18.5),
      ...column(4, named('g', 35).slice(29), 58.5),
    ])
  })

  // Rule 11 with a second mark: line 1 refers to G (35 lines, its start
  // never fits) and to H (1 line). Page 1 keeps line 1, 8 lines of G and
  // h1: the cut of G leaves one line for H. Catches a cut that takes all the
  // room and sends H whole to the next page, while its mark stays on page 1.
  it('starts every note of a forced page on it: a cut leaves a line for each note after it', async () => {
    const { parsed } = await render(noteDocument([flowLine('L1', 'G', 'H'), ...lines(2, 3)], [noteBody('G', named('g', 35), { orphans: 12 }), noteBody('H', ['h1'])]))
    expect(placesOf(parsed)).toEqual([
      '1 L1 18.5',
      ...column(1, [...named('g', 8), 'h1'], 28.5),
      ...column(2, named('g', 18).slice(8), 18.5),
      ...column(3, named('g', 28).slice(18), 18.5),
      ...column(4, ['L2', 'L3'], 18.5),
      ...column(4, named('g', 35).slice(28), 48.5),
    ])
  })

  // Rule 11 below a top padding: a view with 15 pt of top padding holds
  // lines 1 to 8 and 5 pt of bottom padding, so it ends at the page end.
  // Line 1 refers to A (8 lines, counted whole) and B (1 line). The fit's
  // first lower height (30) is in the padding, where the split keeps no line
  // and so keeps the whole view. The first split that keeps a line keeps
  // line 1 (at 35) with 6 lines of A and b1. Catches a forced page that
  // keeps the whole view, so the notes are printed in the bottom padding.
  it('keeps the first flow line on a forced page, not a block a split above its first line keeps', async () => {
    const { parsed } = await render(noteDocument([view({ paddingTop: 15, paddingBottom: 5 }, [flowLine('L1', 'A', 'B'), ...lines(2, 8)])], [noteBody('A', named('a', 8)), noteBody('B', ['b1'])]))
    expect(placesOf(parsed)).toEqual([
      '1 L1 33.5',
      ...column(1, [...named('a', 6), 'b1'], 48.5),
      ...column(2, named('L', 8).slice(1), 18.5),
      ...column(2, ['a7', 'a8'], 98.5),
    ])
    expect(parsed.pages).toHaveLength(2)
  })

  /** A mark: an inline text that links to note `id`, as `flowLine` adds them. */
  const mark = (id: string) => ({ type: PDF_PRIMITIVES.Text, box: {}, style: { fontSize: 7 }, props: { href: `#${id}` }, children: [{ type: PDF_PRIMITIVES.TextInstance, value: id }] })
  /** A text with wrap={false} of the lines V1 to V`count`, line n with a mark to `marks[n - 1]`. */
  const forcedText = (marks: readonly string[], count: number) => ({
    type: PDF_PRIMITIVES.Text,
    box: {},
    style: {},
    props: { wrap: false },
    children: named('V', count).flatMap((text, at) => [{ type: PDF_PRIMITIVES.TextInstance, value: at === 0 ? text : `\n${text}` }, ...(at < marks.length ? [mark(marks[at]!)] : [])]),
  }) as unknown as ElementNode

  // Rule 11 draws nothing below the page end. A text with wrap={false} of 8
  // lines (V1 to V8) refers to A to D (1 line each) from V1 to V4; it fits
  // the page but not with its notes, so the page is forced at its end (100).
  // The first lines of A and B fill the room (20); C, D and every note after
  // them go whole to page 2, first in its area, before E. Catches a forced
  // page that keeps a line of every note (c1 and d1 below the page end, at
  // 119 and 129) and deferred notes after the next page's own notes.
  it('moves the notes whose first line does not fit on a forced page to the next page, in order', async () => {
    const { parsed } = await render(noteDocument([forcedText(['A', 'B', 'C', 'D'], 8), ...lines(1, 3, { 1: 'E' })], ['A', 'B', 'C', 'D', 'E'].map(id => noteBody(id, [`${id.toLowerCase()}1`]))))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('V', 8), 18.5),
      ...column(1, ['a1', 'b1'], 98.5),
      ...column(2, named('L', 3), 18.5),
      ...column(2, ['c1', 'd1', 'e1'], 88.5),
    ])
  })

  // The rest of a cut note comes before the notes that moved: A (3 lines)
  // is cut after a1, C does not start. Catches a carried list with the
  // moved notes first (c1 before a2).
  it('prints the rest of a cut note before the notes that moved', async () => {
    const { parsed } = await render(noteDocument([forcedText(['A', 'B', 'C'], 8), ...lines(1, 1)], [noteBody('A', named('a', 3)), noteBody('B', ['b1']), noteBody('C', ['c1'])]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('V', 8), 18.5),
      ...column(1, ['a1', 'b1'], 98.5),
      '2 L1 18.5',
      ...column(2, ['a2', 'a3', 'c1'], 88.5),
    ])
  })

  // The gap before a note counts for its start: with a gap of 5, b1 needs
  // 15 of the 10 left after a1. Catches a start that leaves the gap out (b1
  // at 114, below the page end 120).
  it('counts the gap before a note when it decides whether the note starts', async () => {
    const { parsed } = await render(noteDocument([forcedText(['A', 'B', 'C'], 8)], ['A', 'B', 'C'].map(id => noteBody(id, [`${id.toLowerCase()}1`])), { gap: 5 }))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('V', 8), 18.5),
      '1 a1 108.5',
      '2 b1 93.5',
      '2 c1 108.5',
    ])
  })

  // A note whose one line is higher than the page never starts with its
  // mark. The page after holds it alone and starts it, so pagination goes
  // on. Catches a page with no flow that moves every note: pagination
  // cannot end.
  it('starts a note higher than the page on a page that takes no flow', async () => {
    const { parsed, layout } = await render(noteDocument(lines(1, 2, { 1: 'A' }), [{ ...noteBody('A', ['a1']), style: { fontSize: 150 } } as ElementNode]))
    expect(placesOf(parsed)).toEqual(['1 L1 18.5', '3 L2 18.5'])
    // Page 2 holds only the note area with A, whose line runs past the page end (text extraction drops it).
    const [, second] = layout.children as LaidOutNode[]
    expect((second!.children as LaidOutNode[]).map(area => (area.children as LaidOutNode[]).map(note => note.props.id))).toEqual([['A']])
  })

  // Order before fullness: after the forced text, B's first line needs 25
  // (its top margin 15) and does not fit the 10 left; C would fit, but it
  // moves with B. Catches a forced page that skips B and starts C.
  it('moves every note after the first one that does not start, also one that would fit', async () => {
    const notes = [noteBody('A', ['a1']), { ...noteBody('B', ['b1']), style: { marginTop: 15 } } as ElementNode, noteBody('C', ['c1'])]
    const { parsed } = await render(noteDocument([forcedText(['A', 'B', 'C'], 9), ...lines(1, 2)], notes))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('V', 9), 18.5),
      '1 a1 108.5',
      ...column(2, named('L', 2), 18.5),
      ...column(2, ['b1', 'c1'], 98.5),
    ])
  })

  // A view with wrap={false} higher than the page (130) stays and is shrunk
  // above its notes, which sit at the page bottom. Its line refers to 12
  // one-line notes; the content area holds 10, and K and L go to page 2.
  // Catches an area that starts above the content top (at 0, with all 12).
  it('moves the notes beyond the content area of a page whose block is shrunk', async () => {
    const ids = named('N', 12)
    const { parsed } = await render(noteDocument([view({ height: 130 }, [flowLine('V1', ...ids)], { wrap: false })], ids.map(id => noteBody(id, [id.toLowerCase()]))))
    expect(placesOf(parsed).filter(place => / n\d+ /.test(place))).toEqual([
      ...column(1, named('n', 10), 18.5),
      ...column(2, ['n11', 'n12'], 98.5),
    ])
  })

  // A view whose first child is a text with wrap={false} (V1 to V4, a mark
  // to A, 2 lines), then lines 1 to 6, each with a mark to a 1-line note.
  // Any split inside the text keeps the whole view (a break at the page top
  // gains nothing), with all seven notes. The split below the text fits,
  // and the page goes up from it to L2 with a1, a2, b1 and c1. Catches a
  // forced page that takes the first split that keeps a line, the whole
  // view, and prints its notes in the bottom padding; and a search up that
  // stops at phase 1's lowest height (the page keeps only the text).
  it('keeps the least a page can hold when splits inside a text with wrap={false} keep everything', async () => {
    const text = { type: PDF_PRIMITIVES.Text, box: {}, style: {}, props: { wrap: false }, children: [{ type: PDF_PRIMITIVES.TextInstance, value: 'V1' }, mark('A'), { type: PDF_PRIMITIVES.TextInstance, value: '\nV2\nV3\nV4' }] } as unknown as ElementNode
    const ids = ['B', 'C', 'D', 'E', 'F', 'G']
    const { parsed } = await render(noteDocument([view({}, [text, ...ids.map((id, at) => flowLine(`L${at + 1}`, id))])], [noteBody('A', named('a', 2)), ...ids.map(id => noteBody(id, [`${id.toLowerCase()}1`]))]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, ['V1', 'V2', 'V3', 'V4', 'L1', 'L2'], 18.5),
      ...column(1, ['a1', 'a2', 'b1', 'c1'], 78.5),
      ...column(2, ['L3', 'L4', 'L5', 'L6'], 18.5),
      ...column(2, ['d1', 'e1', 'f1', 'g1'], 78.5),
    ])
  })

  // A block with wrap={false} of lines V1 to V6 after 4 lines: with its
  // notes (A, 3 lines, from V1; B, 5 lines, from V5) it does not fit below
  // them, so it moves whole to page 2. The move lets a block higher than a
  // page split there; this one fits the page, so it stays whole although its
  // notes do not fit beside it: A whole, b1, and B goes on to page 3.
  // Catches a fit that cuts the moved block above V5 to make room for its
  // notes, for a view and for a text.
  it.each<[string, ElementNode]>([
    ['view', view({}, ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map(text => text === 'V1' ? flowLine(text, 'A') : text === 'V5' ? flowLine(text, 'B') : flowLine(text)), { wrap: false })],
    ['text', { type: PDF_PRIMITIVES.Text, box: {}, style: {}, props: { wrap: false }, children: [{ type: PDF_PRIMITIVES.TextInstance, value: 'V1' }, mark('A'), { type: PDF_PRIMITIVES.TextInstance, value: '\nV2\nV3\nV4\nV5' }, mark('B'), { type: PDF_PRIMITIVES.TextInstance, value: '\nV6' }] } as unknown as ElementNode],
  ])('keeps a moved %s with wrap={false} whole when its notes do not fit beside it', async (_kind, block) => {
    const { parsed } = await render(noteDocument([...lines(1, 4), block], [noteBody('A', named('a', 3)), noteBody('B', named('b', 5))]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('L', 4), 18.5),
      ...column(2, named('V', 6), 18.5),
      ...column(2, [...named('a', 3), 'b1'], 78.5),
      ...column(3, named('b', 5).slice(1), 78.5),
    ])
  })

  // A page with `justifyContent: 'flex-end'` and a note area: the flow ends
  // at the area top (90), so lines 1 to 5 end there, and a footer with
  // `bottom: 5` keeps its place against the page. Catches a relayout that
  // gives the flow the whole content height (L3 to L5 printed on the notes).
  it('ends the flow at the note area: justifyContent and absolute children', async () => {
    const footer = { ...flowLine('foot'), style: { position: 'absolute', bottom: 5, left: 20 } } as ElementNode
    const { parsed } = await render(noteDocument([...lines(1, 5, { 3: 'A' }), footer], [noteBody('A', named('a', 3))], {}, { justifyContent: 'flex-end' }))
    expect(placesOf(parsed)).toEqual([...column(1, named('L', 5), 38.5), '1 foot 123.5', ...column(1, named('a', 3), 88.5)])
  })

  // A spacer that grows between lines 1 to 3 and a signature line: it grows
  // to the area top, not to the page end. Catches a spacer that grows to 120
  // (the signature printed on the notes).
  it('lets a growing box take the room above the note area only', async () => {
    const { parsed, layout } = await render(noteDocument([...lines(1, 3, { 2: 'A' }), view({ flexGrow: 1 }, []), flowLine('sig')], [noteBody('A', named('a', 3))]))
    expect(placesOf(parsed)).toEqual([...column(1, named('L', 3), 18.5), '1 sig 78.5', ...column(1, named('a', 3), 88.5)])
    const spacer = layout.children[0]!.children[3] as LaidOutNode
    expect([spacer.box.top, spacer.box.height]).toEqual([50, 30])
  })

  // Marks inside boxes: an unbreakable view whose first line refers to A
  // moves to page 2 with its note, and so does a row of two cells whose
  // second cell's first line refers to B. Catches a reference search that
  // reads only texts at the top of the page (the box stays on page 1 and
  // its note is never placed).
  it.each([
    { label: 'an unbreakable view', box: view({}, [flowLine('v1', 'A'), flowLine('v2')], { wrap: false }), places: ['2 v1 18.5', '2 v2 28.5'] },
    { label: 'a row of two cells', box: view({ flexDirection: 'row' }, [view({ flexGrow: 1, flexBasis: 0 }, [flowLine('c1'), flowLine('c2')]), view({ flexGrow: 1, flexBasis: 0 }, [flowLine('d1', 'A'), flowLine('d2')])]), places: ['2 c1 18.5', '2 c2 28.5', '2 d1 18.5 x100', '2 d2 28.5 x100'] },
  ])('moves a mark in $label with its note', async ({ box, places }) => {
    const { parsed } = await render(noteDocument([...lines(1, 8), box], [noteBody('A', named('a', 2))]))
    expect(placesOf(parsed)).toEqual([...column(1, named('L', 8), 18.5), ...places, ...column(2, ['a1', 'a2'], 98.5)])
  })

  // A `fixed` line after the flow repeats under the flow on every page, so
  // the notes go below it: line 8 refers to A and stays, as 8 lines, the
  // footer and A fill the page. Catches a part end without the fixed nodes
  // after the flow (9 lines on page 1, A printed on the footer).
  it('places the notes below a fixed line that follows the flow', async () => {
    const footer = { ...flowLine('foot'), props: { fixed: true } } as ElementNode
    const { parsed } = await render(noteDocument([...lines(1, 12, { 8: 'A' }), footer], [noteBody('A', ['a1'])]))
    expect(placesOf(parsed)).toEqual([...column(1, named('L', 8), 18.5), '1 foot 98.5', '1 a1 108.5', ...column(2, ['L9', 'L10', 'L11', 'L12', 'foot'], 18.5)])
  })

  // A tagged document gives each inline link a suffix after U+0000 (its
  // structure element); a mark is still found by the part before it.
  // Catches a note id read with the suffix (the note is never placed).
  it('finds a mark whose link has the suffix of a tagged link', async () => {
    const marked = flowLine('L10', 'A')
    const mark = marked.children!.at(-1) as ElementNode
    mark.props = { href: '#A\u00001' }
    const { parsed } = await render(noteDocument([...lines(1, 9), marked], [noteBody('A', named('a', 2))]))
    expect(placesOf(parsed)).toEqual([...column(1, named('L', 9), 18.5), '2 L10 18.5', ...column(2, ['a1', 'a2'], 98.5)])
  })

  // Two marks on one line: both notes move with it. A line with
  // `minPresenceAhead` before a reference line: when the reference line
  // moves, so does it. Catches a line read for its first mark only (L9 stays
  // with a1 alone) and a fit that keeps the presence line alone at the end.
  it.each([
    { label: 'two marks on one line', flow: [...lines(1, 8), flowLine('L9', 'A', 'B'), ...lines(10, 12)], expected: [...column(1, named('L', 8), 18.5), ...column(2, ['L9', 'L10', 'L11', 'L12'], 18.5), '2 a1 98.5', '2 b1 108.5'] },
    { label: 'a minPresenceAhead line before the reference line', flow: [...lines(1, 7), { ...flowLine('L8'), props: { minPresenceAhead: 20 } } as ElementNode, flowLine('L9', 'A'), ...lines(10, 12)], expected: [...column(1, named('L', 7), 18.5), ...column(2, ['L8', 'L9', 'L10', 'L11', 'L12'], 18.5), '2 a1 108.5'] },
  ])('moves $label with its notes', async ({ flow, expected }) => {
    const { parsed } = await render(noteDocument(flow, [noteBody('A', ['a1']), noteBody('B', ['b1'])]))
    expect(placesOf(parsed)).toEqual(expected)
  })
})

describe('footnotes on a page with columns', () => {
  // Two columns of 70 pt with a 20 pt gap: the second starts at x 110. The
  // note area is page-wide below all columns, its notes in reading order
  // (column by column). Each try of the fit balances the columns at its
  // height and splits there.
  const TWO = { columnCount: 2, columnGap: 20 }
  /** Like `column`, for texts in the second column. */
  const right = (page: number, texts: readonly string[], top: number): string[] => column(page, texts, top).map(place => `${place} x110`)
  const block = (count: number) => view({}, [flowLine(named('B', count).join('\n'))], { wrap: false })

  // (a) A reference in column 2: 12 lines balance 6 and 6, the note sits
  // full width below both. Catches a note area per column or at column
  // width. (f) Two lines in two columns (default gap, column 2 at x 105):
  // once a typed error, now placed. (g) A container between two texts: the
  // area is below the page flow, after the text that follows the columns.
  // (h) A reference in a child with columnSpan 'all': its note too.
  it.each([
    { label: '(a) a reference in column 2', flow: [view(TWO, lines(1, 12, { 9: 'A' }))], notes: [noteBody('A', ['a1'])], expected: [...column(1, named('L', 6), 18.5), ...right(1, ['L7', 'L8', 'L9', 'L10', 'L11', 'L12'], 18.5), '1 a1 108.5'] },
    { label: '(f) two lines in two columns', flow: [view({ columnCount: 2 }, lines(1, 2, { 1: 'A' }))], notes: [noteBody('A', ['a1'])], expected: ['1 L1 18.5', '1 L2 18.5 x105', '1 a1 108.5'] },
    { label: '(g) a view container between two texts', flow: [flowLine('Intro'), view(TWO, lines(1, 8, { 6: 'A' })), flowLine('After')], notes: [noteBody('A', named('a', 2))], expected: ['1 Intro 18.5', ...column(1, named('L', 4), 28.5), ...right(1, ['L5', 'L6', 'L7', 'L8'], 28.5), '1 After 68.5', '1 a1 98.5', '1 a2 108.5'] },
    { label: '(h) a reference in a child that spans all columns', flow: [view(TWO, [...lines(1, 4), { ...flowLine('S1', 'A'), style: { columnSpan: 'all' } } as ElementNode, ...lines(5, 8)])], notes: [noteBody('A', named('a', 2))], expected: ['1 L1 18.5', '1 L2 28.5', ...right(1, ['L3', 'L4'], 18.5), '1 S1 38.5', '1 L5 48.5', '1 L6 58.5', ...right(1, ['L7', 'L8'], 48.5), '1 a1 98.5', '1 a2 108.5'] },
  ])('places the note of $label below all columns', async ({ flow, notes, expected }) => {
    const { parsed } = await render(noteDocument(flow, notes))
    expect(placesOf(parsed)).toEqual(expected)
  })

  // (b) A container that ends on the page is balanced above the area: 14
  // lines in 7 and 7 (to 90), the text after it, the note's 2 lines at the
  // page bottom. Catches a balance at the page end that the notes then
  // cover, or columns filled in order (10 and 4).
  it('(b) balances a container that ends on a page with notes above the area', async () => {
    const { parsed } = await render(noteDocument([view(TWO, lines(1, 14, { 2: 'A' })), flowLine('After')], [noteBody('A', named('a', 2))]))
    expect(placesOf(parsed)).toEqual([...column(1, named('L', 7), 18.5), ...right(1, ['L8', 'L9', 'L10', 'L11', 'L12', 'L13', 'L14'], 18.5), '1 After 88.5', '1 a1 98.5', '1 a2 108.5'])
  })

  // (c) A reference line whose note (3 lines) does not fit with it moves on.
  // L20 ends column 2 at the page end: the page keeps 9 and 9 lines (110 is
  // the highest that fits, found by bisection), L19 and L20 go to page 2.
  // L10 ends column 1 at the page end: at 90 it is third in column 2, with
  // room for the note. Catches a fit that keeps the line without its note,
  // or a page that ends lower than it must.
  it.each([
    { label: 'the next page', at: 20, expected: [...column(1, named('L', 9), 18.5), ...right(1, ['L10', 'L11', 'L12', 'L13', 'L14', 'L15', 'L16', 'L17', 'L18'], 18.5), '2 L19 18.5', '2 L20 28.5', ...right(2, ['L21', 'L22'], 18.5), ...column(2, named('a', 3), 88.5)] },
    { label: 'the next column', at: 10, expected: [...column(1, named('L', 7), 18.5), ...right(1, ['L8', 'L9', 'L10', 'L11', 'L12', 'L13', 'L14'], 18.5), ...column(1, named('a', 3), 88.5), ...column(2, ['L15', 'L16', 'L17', 'L18'], 18.5), ...right(2, ['L19', 'L20', 'L21', 'L22'], 18.5)] },
  ])('(c) moves a reference line whose note does not fit to $label', async ({ at, expected }) => {
    const { parsed } = await render(noteDocument([view(TWO, lines(1, 22, { [at]: 'A' }))], [noteBody('A', named('a', 3))]))
    expect(placesOf(parsed)).toEqual(expected)
  })

  // (d) Phase 2 ends at a height that only column 2 ends at: a 15 pt block
  // after L9 puts the lines of column 2 at 45, 55, … 105 while column 1
  // ends at 30, 40, … 100. L16 refers to A, so 115 fails; 105 holds L15 in
  // column 2. Catches the bisection over the galley's bottoms (finding (am)
  // for notes): it stops at 100 and moves L15 to page 2.
  it('(d) ends a page with notes at a height only a later column ends at', async () => {
    const flow = [view(TWO, [...lines(1, 9), view({ height: 15 }, [], { wrap: false }), ...lines(10, 20, { 16: 'A' })])]
    const { parsed } = await render(noteDocument(flow, [noteBody('A', named('a', 2))]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('L', 8), 18.5),
      ...right(1, ['L9'], 18.5),
      ...right(1, ['L10', 'L11', 'L12', 'L13', 'L14', 'L15'], 43.5),
      ...column(2, ['L16', 'L17', 'L18'], 18.5),
      ...right(2, ['L19', 'L20'], 18.5),
      '2 a1 98.5',
      '2 a2 108.5',
    ])
  })

  // (e) A note part carried onto a page with columns: B (8 lines) starts on
  // page 1 with its reference in L6; its 6 other lines come first on page 2,
  // where the container fills in order above them (2 and 2 lines) and
  // balances on page 3.
  it('(e) puts a carried note part below the columns of the next page', async () => {
    const flow = [...lines(1, 9, { 6: 'B' }), view(TWO, lines(10, 20, { 15: 'A' }))]
    const { parsed } = await render(noteDocument(flow, [noteBody('B', named('b', 8)), noteBody('A', ['a1'])]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('L', 8), 18.5),
      ...column(1, ['b1', 'b2'], 98.5),
      ...column(2, ['L9', 'L10', 'L11'], 18.5),
      ...right(2, ['L12', 'L13'], 28.5),
      ...column(2, ['b3', 'b4', 'b5', 'b6', 'b7', 'b8'], 58.5),
      ...column(3, ['L14', 'L15', 'L16', 'L17'], 18.5),
      ...right(3, ['L18', 'L19', 'L20'], 18.5),
      '3 a1 108.5',
    ])
  })

  // (i) A container that would end on the page until its notes take room:
  // 18 lines balance 9 and 9 at the page end, but the note (3 lines) does
  // not fit below them. At 90 the container crosses the page end and fills
  // in order (7 and 7); page 2 balances the rest (2 and 2). Catches a part
  // measured by the galley's box (each try below the page end failed, and
  // rule 11 kept one note line).
  it('(i) fills a container in order when its notes push it past the page end', async () => {
    const { parsed } = await render(noteDocument([view(TWO, lines(1, 18, { 2: 'A' })), flowLine('After')], [noteBody('A', named('a', 3))]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('L', 7), 18.5),
      ...right(1, ['L8', 'L9', 'L10', 'L11', 'L12', 'L13', 'L14'], 18.5),
      ...column(1, named('a', 3), 88.5),
      ...column(2, ['L15', 'L16'], 18.5),
      ...right(2, ['L17', 'L18'], 18.5),
      '2 After 38.5',
    ])
  })

  // (j) columnFill 'auto' with notes: never balanced. Page 1 ends at 80
  // (6 and 6), since at 90 L14 is in column 2 and A and B need 40 pt; page
  // 2 fills column 1 to the area (8 lines) before column 2.
  it('(j) fills columns in order above the notes with columnFill auto', async () => {
    const flow = [view({ ...TWO, columnFill: 'auto' }, lines(1, 24, { 3: 'A', 14: 'B' }))]
    const { parsed } = await render(noteDocument(flow, [noteBody('A', named('a', 2)), noteBody('B', named('b', 2))]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('L', 6), 18.5),
      ...right(1, ['L7', 'L8', 'L9', 'L10', 'L11', 'L12'], 18.5),
      ...column(1, ['a1', 'a2'], 98.5),
      ...column(2, ['L13', 'L14', 'L15', 'L16', 'L17', 'L18', 'L19', 'L20'], 18.5),
      ...right(2, ['L21', 'L22', 'L23', 'L24'], 18.5),
      ...column(2, ['b1', 'b2'], 98.5),
    ])
  })

  // (k) Rule 11 on a column page: A's start (12 lines, its orphans) never
  // fits. The first height that keeps a flow line (30) keeps one line in
  // each column, and the note fills the room left; note pages follow, and
  // the rest of the flow comes after them.
  it('(k) keeps the least a column page can hold when a note start never fits', async () => {
    const { parsed } = await render(noteDocument([view(TWO, lines(1, 6, { 1: 'A' }))], [noteBody('A', named('a', 30), { orphans: 12 })]))
    expect(placesOf(parsed)).toEqual([
      '1 L1 18.5',
      '1 L2 18.5 x110',
      ...column(1, named('a', 9), 28.5),
      ...column(2, named('a', 19).slice(9), 18.5),
      ...column(3, named('a', 29).slice(19), 18.5),
      '4 L3 18.5',
      '4 L4 28.5',
      ...right(4, ['L5', 'L6'], 18.5),
      '4 a30 108.5',
    ])
  })

  // A block with wrap={false} (6 lines) that moved to page 2 whole stays
  // whole in column 1 there, also at the heights where its notes take room
  // (`unsplittableAgain` with the notes' predicate). The note's start (5
  // lines) does not fit beside it, so the page is forced: its 4 lines go
  // below, and L24 moves on. Catches a fit that cuts the block across the
  // two columns (B1 to B3 and B4 to B6).
  it('keeps a block with wrap={false} that moved to a column page whole above its notes', async () => {
    const flow = [view(TWO, [...lines(1, 17), block(6), ...lines(18, 24, { 18: 'A' })])]
    const { parsed } = await render(noteDocument(flow, [noteBody('A', named('a', 8), { orphans: 5 })]))
    expect(placesOf(parsed)).toEqual([
      ...column(1, named('L', 10), 18.5),
      ...right(1, ['L11', 'L12', 'L13', 'L14', 'L15', 'L16', 'L17'], 18.5),
      ...column(2, named('B', 6), 18.5),
      ...right(2, ['L18', 'L19', 'L20', 'L21', 'L22', 'L23'], 18.5),
      ...column(2, named('a', 4), 78.5),
      '3 L24 18.5',
      ...column(3, ['a5', 'a6', 'a7', 'a8'], 78.5),
    ])
  })
})
