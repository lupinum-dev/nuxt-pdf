import { defineComponent, h, type VNodeChild } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { renderPdfTemplate } from '../src/test/render-template'

const { PdfDocument, PdfPage, PdfPageNumber, PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfText, PdfView } = PDF_COMPONENTS

// Long documents of container shapes whose child positions depend on what
// comes after them: minHeight, height, maxHeight, flexGrow, column-reverse,
// justifyContent, forced breaks, wrap={false}, a fixed child, page numbers,
// and a bottom margin or padding below a page end. They were written for the
// pagination cut that the page builder replaced (internals/performance.md);
// the pins were checked then against a layout of the whole rest. They catch
// a builder sum that drifts from yoga on these shapes: the page check throws,
// or a pin moves. A pin is a page, or [page, y of its baseline from the page
// bottom] where a wrong sum moves a text but not across a page. "Cut" and
// "kept whole" in the names are the cut's old cases.

const text = (mark: string, style: Record<string, unknown> = {}) => h(PdfText, { style: { fontSize: 11, marginBottom: 4, ...style } }, { default: () => mark })

const rows = (count: number, mark: (index: number) => string = index => `row ${index}`): VNodeChild[] =>
  Array.from({ length: count }, (_, index) => h(PdfText, { style: { fontSize: 11, marginBottom: 4 } }, { default: () => mark(index) }))

/** One text of 37 lines of 10 pt, `${prefix}0` to `${prefix}36`. */
const lines = (prefix: string, style: Record<string, unknown> = {}) =>
  h(PdfText, { style: { fontSize: 10, lineHeight: 1, ...style } }, { default: () => Array.from({ length: 37 }, (_, index) => `${prefix}${index}`).join('\n') })

const page = (children: () => VNodeChild[], style: Record<string, unknown> = {}) =>
  defineComponent(() => () => h(PdfDocument, null, {
    default: () => h(PdfPage, { size: 'A6', style: { padding: 24, ...style } }, { default: children }),
  }))

const table = (count: number) => h(PdfTable, { columns: ['30pt', 1] }, {
  default: () => [
    h(PdfTableHeader, null, { default: () => ['#', 'Entry'].map(label => h(PdfTableCell, null, { default: () => label })) }),
    ...Array.from({ length: count }, (_, index) => h(PdfTableRow, null, {
      default: () => [
        h(PdfTableCell, null, { default: () => String(index) }),
        h(PdfTableCell, null, { default: () => index % 7 === 3 ? `MARK ${index} with a longer entry that wraps onto a second line` : `entry ${index}` }),
      ],
    })),
  ],
})

const DOCUMENTS: [name: string, document: ReturnType<typeof page>, pages: Record<string, number | [page: number, y: number]>][] = [
  ['a long page of texts (the page part is cut)', page(() => rows(120)), { 'row 0': 1, 'row 40': 2, 'row 119': 6 }],
  ['a column inside a column, both cut', page(() => [h(PdfView, { style: { paddingTop: 10 } }, {
    default: () => [h(PdfView, { style: { gap: 3 } }, { default: () => rows(100) }), h(PdfText, null, { default: () => 'after inner' })],
  }), h(PdfText, null, { default: () => 'after outer' })]), { 'row 0': 1, 'row 99': 6, 'after inner': 6, 'after outer': 6 }],
  ['a table: rows stay whole, the header repeats', page(() => [table(140)]), { 'MARK 3': 1, 'MARK 59': 5, 'MARK 136': 11 }],
  ['justifyContent and flexGrow in a column with an automatic height', page(() => [h(PdfView, { style: { justifyContent: 'space-between' } }, {
    default: () => [...rows(60), h(PdfView, { style: { flexGrow: 1, height: 20, backgroundColor: '#ddd' } }), ...rows(60, index => `late ${index}`)],
  })], { justifyContent: 'flex-end' }), { 'row 0': 1, 'row 59': 3, 'late 0': 3, 'late 59': 6 }],
  // Finding (aq): the content passes the minHeight on the page where the
  // view starts, so the cut enters its rests; `justifyContent` would move
  // the rows only in a view its content does not fill.
  ['a column with a minHeight its content passes (cut)', page(() => [...rows(30), h(PdfView, { style: { minHeight: 300, justifyContent: 'flex-end' } }, { default: () => rows(100, index => `inner ${index}`) }), text('after')]), { 'inner 0': [2, 271.7], 'inner 50': 4, 'inner 99': 6, 'after': 6 }],
  // The view starts on page 3, low in the rest of page 2: 340 pt is less
  // than a page, but its top plus 340 pt is not, and the content the cut
  // keeps of it there is lower than 340 pt. The cut enters it from page 4.
  ['a column with a minHeight that starts low in its rest (its top counts)', page(() => [...rows(60), h(PdfView, { style: { minHeight: 340, justifyContent: 'flex-end' } }, { default: () => rows(100, index => `inner ${index}`) }), text('after')]), { 'inner 0': [3, 159], 'inner 50': 5, 'inner 99': 7, 'after': 7 }],
  // The cut must not enter it: in a layout of its kept content the
  // growing view would take the room up to the minHeight, which the whole
  // content passes, and every top after it would follow the grown box.
  ['a column with a minHeight and a growing child across the line (kept whole)', page(() => [...rows(30), h(PdfView, { style: { minHeight: 1500 } }, {
    default: () => [...rows(30, index => `inner ${index}`), h(PdfView, { style: { height: 600, flexGrow: 1, backgroundColor: '#ddd' } }), ...rows(40, index => `late ${index}`)],
  }), text('after')]), { 'inner 29': [3, 176.33], 'late 0': [5, 299.9], 'late 39': 6, 'after': 6 }],
  ['a column with a minHeight (kept whole)', page(() => [h(PdfView, { style: { minHeight: 2400, justifyContent: 'space-between' } }, { default: () => rows(80) }), ...rows(40, index => `late ${index}`)]), { 'row 0': 1, 'row 40': 4, 'row 79': 7, 'late 39': 9 }],
  ['a column with a height and shrinking children (kept whole)', page(() => [h(PdfView, { style: { height: 1600 } }, { default: () => rows(120) }), ...rows(40, index => `late ${index}`)]), { 'row 0': 1, 'row 28': [2, 385.63], 'row 60': 3, 'row 119': 5, 'late 39': 7 }],
  // Its parts share the 1200 pt, its rows keep the heights yoga gave them in it (today's split let the parts grow: 8 pages).
  ['a column with a maxHeight its children shrink in (kept whole)', page(() => [...rows(30), h(PdfView, { style: { maxHeight: 1200 } }, { default: () => rows(150, index => `inner ${index}`) }), ...rows(30, index => `late ${index}`)]), { 'inner 1': [2, 264.93], 'inner 149': 5, 'late 29': 6 }],
  ['a column-reverse container whose first child is cut (kept whole)', page(() => [...rows(30), h(PdfView, { style: { flexDirection: 'column-reverse' } }, {
    default: () => [h(PdfView, null, { default: () => rows(80, index => `deep ${index}`) }), ...rows(10, index => `top ${index}`)],
  })]), { 'top 9': 2, 'deep 0': [2, 111.93], 'deep 79': 6 }],
  ['a column with a percentage paddingTop (cut, its padding read from the box)', page(() => [...rows(30), h(PdfView, { style: { paddingTop: '5%' } }, { default: () => rows(100, index => `inner ${index}`) }), text('after')]), { 'inner 0': 2, 'inner 99': 6, 'after': 6 }],
  ['a child with a percentage marginTop (its margin read from the box)', page(() => [...rows(30), text('pushed', { marginTop: '5%' }), ...rows(90, index => `late ${index}`)]), { 'pushed': 2, 'late 89': 6 }],
  ['a child with a percentage marginBottom (its margin read from the box)', page(() => [...rows(30), text('spaced', { marginBottom: '5%' }), ...rows(90, index => `late ${index}`)]), { 'spaced': 2, 'late 89': 6 }],
  ['a child with a bottom inset (kept whole)', page(() => [...rows(50), text('moved up', { bottom: 12 }), ...rows(50, index => `late ${index}`)]), { 'moved up': 3, 'late 49': 5 }],
  ['an absolute child without an inset in a column at the bottom (kept whole)', page(() => [...rows(30), h(PdfView, { style: { justifyContent: 'flex-end' } }, {
    default: () => [h(PdfText, { style: { position: 'absolute', fontSize: 8 } }, { default: () => 'floating' }), ...rows(100, index => `inner ${index}`)],
  })]), { 'floating': 6, 'inner 99': 6 }],
  // The pulled text follows row 70 to page 4 and starts at its content top,
  // over row 69, instead of 450pt above it; the rows after it follow.
  ['a negative marginTop larger than a content area (kept whole)', page(() => [...rows(71), text('pulled up', { marginTop: -450 }), ...rows(60, index => `late ${index}`)]), { 'row 70': [4, 369.53], 'pulled up': [4, 385.63], 'late 0': [4, 369.53], 'late 1': [4, 353.43] }],
  ['a negative marginBottom larger than a page (kept whole)', page(() => [...rows(30), h(PdfView, { wrap: false, style: { height: 700, marginBottom: -600, backgroundColor: '#ddd' } }), text('pulled up'), ...rows(40, index => `late ${index}`)]), { 'pulled up': 3, 'late 39': 4 }],
  ['a node kept whole that is taller than a page', page(() => [...rows(5), h(PdfView, { wrap: false }, { default: () => rows(30, index => `kept ${index}`) }),
    h(PdfView, { wrap: false }, { default: () => rows(60, index => `tall ${index}`) }), ...rows(30, index => `late ${index}`)]), { 'kept 29': 1, 'tall 59': 2, 'late 22': 3, 'late 29': 4 }],
  ['a page with an absolute child at its bottom (kept whole)', page(() => [...rows(100), h(PdfView, { style: { position: 'absolute', bottom: 0, left: 0, height: 8, width: 8, backgroundColor: '#000' } })]), { 'row 0': 1, 'row 99': 5 }],
  ['a child with a negative margin (kept whole)', page(() => [...rows(60), h(PdfText, { style: { marginTop: -30 } }, { default: () => 'pulled up' }), ...rows(60, index => `late ${index}`)]), { 'row 59': 3, 'pulled up': 3, 'late 59': 6 }],
  ['a child with a height and one with an inset (kept whole)', page(() => [h(PdfView, null, {
    default: () => [...rows(50), h(PdfView, { style: { height: 40, backgroundColor: '#ddd' } }), h(PdfText, { style: { top: 12 } }, { default: () => 'moved down' }), ...rows(50, index => `late ${index}`)],
  }), ...rows(40, index => `after ${index}`)]), { 'row 49': 3, 'moved down': 3, 'late 49': 5, 'after 39': 7 }],
  ['a column-reverse container (kept whole)', page(() => [h(PdfView, { style: { flexDirection: 'column-reverse' } }, { default: () => rows(90) }), ...rows(40, index => `late ${index}`)]), { 'row 0': 4, 'row 89': 1, 'late 39': 6 }],
  ['minPresenceAhead near each page end', page(() => Array.from({ length: 40 }, (_, index) => [
    h(PdfText, { minPresenceAhead: 60, style: { fontSize: 14 } }, { default: () => `heading ${index}` }),
    h(PdfText, { style: { fontSize: 11, marginBottom: 6 } }, { default: () => `body ${index} under its heading, long enough for two lines of text` }),
  ]).flat()), { 'heading 0': 1, 'heading 13': 2, 'heading 39': 6 }],
  ['forced breaks far below the page end', page(() => rows(150, index => `row ${index}`).map((row, index) => index % 37 === 36 ? h(PdfView, { break: true }, { default: () => row }) : row)), { 'row 35': 2, 'row 36': 3, 'row 110': 7, 'row 149': 9 }],
  ['nodes kept whole across the line (wrap={false})', page(() => Array.from({ length: 30 }, (_, index) =>
    h(PdfView, { wrap: false, style: { marginBottom: 6 } }, { default: () => rows(5, line => `block ${index} line ${line}`) }))), { 'block 0 line 0': 1, 'block 7 line 4': 2, 'block 29 line 4': 8 }],
  ['a fixed child in the flow and page numbers far below', page(() => [
    h(PdfText, { fixed: true, style: { fontSize: 9 } }, { default: () => 'running head' }),
    ...rows(100).map((row, index) => index % 25 === 24 ? [row, h(PdfText, null, { default: () => ['on page ', h(PdfPageNumber)] })] : row).flat(),
  ]), { 'row 0': 1, 'row 50': 3, 'row 99': 5, 'on page 2': 2, 'on page 5': 5 }],
  // Finding (ai): a node ends on page 1 with its bottom edge below the page
  // end (a bottom margin it loses there, or a bottom padding). Neither page
  // holds that part, but the rest of its container keeps the box of the
  // whole container, which is then higher than its rest by the room page 1
  // took and that part, more than the one content area the cut allows for.
  // The cut held back 'after', which starts above the page end of page 2,
  // and the graft threw. 37 lines of 10 pt end 1.53 pt above the page end;
  // the second text is high enough that its container crosses the read limit.
  ['a node that ends at the page end with its bottom margin below it', page(() => [
    h(PdfView, null, { default: () => [lines('a', { marginBottom: 30 }), lines('b')] }),
    text('after'),
  ]), { a36: 1, b0: 2, b36: 2, after: 3 }],
  ['a node that ends at the page end with its bottom padding below it', page(() => [
    h(PdfView, null, { default: () => [h(PdfView, { style: { paddingBottom: 30 } }, { default: () => [lines('a')] }), lines('b')] }),
    text('after'),
  ]), { a36: 1, b0: 2, b36: 2, after: 3 }],
]

describe('pagination of container shapes', () => {
  it.each(DOCUMENTS)('%s', async (_name, document, pages) => {
    const { parsed } = await renderPdfTemplate(document, {})
    const texts = parsed.pages.map(page => page.text)
    const pageOf = (mark: string) => texts.findIndex(text => text.includes(mark)) + 1
    const positionOf = (mark: string) => {
      for (const { number, textRuns } of parsed.pages) {
        const run = textRuns.find(candidate => candidate.text === mark)
        if (run) return [number, run.y]
      }
      return [0, 0]
    }
    const placed = Object.fromEntries(Object.entries(pages).map(([mark, pinned]) => [mark, typeof pinned === 'number' ? pageOf(mark) : positionOf(mark)]))
    expect(placed).toEqual(pages)
  })
})
