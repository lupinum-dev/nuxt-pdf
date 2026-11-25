import { defineComponent, h, type Component, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import type { PdfStyle } from '../src/runtime/authoring'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { installPdfCanvasGlobals, parsePdf, type ParsedPdf, type ParsedPdfTextRun } from '../src/test/pdf'
import { readPaint } from './invariants/document'

installPdfCanvasGlobals()

const { PdfContents, PdfDocument, PdfLink, PdfPage, PdfRichText, PdfTable, PdfTableCell, PdfTableRow, PdfText, PdfView } = PDF_COMPONENTS
// Untyped, for values that a template can pass and the prop types reject.
const LooseContents: Component = PdfContents
const LooseText: Component = PdfText

// A4 with 40 pt padding and 10 pt text: the content box runs from x 40 to
// 555.28.
const PAGE_HEIGHT = 841.89
const RIGHT = 555.28

const render = async (content: () => VNode[], pageStyle: PdfStyle = {}) => {
  const mounted = await mountPdfComponent(defineComponent(() => () => h(PdfDocument, { creationDate: new Date(0) }, () =>
    h(PdfPage, { size: 'A4', style: { padding: 40, fontSize: 10, ...pageStyle } }, content))))
  try {
    const result = await renderPlainDocument(mounted.document, { compress: false })
    return { ...result, parsed: await parsePdf(result.bytes) }
  }
  finally {
    mounted.unmount()
  }
}

/** A text with a bookmark of its own title; `props` adds to it. */
const heading = (title: string, props: Record<string, unknown> = {}) => h(PdfText, { bookmark: title, ...props }, () => title)

/** A chapter on a new page: a view with a bookmark, its heading, and `children`. */
const chapter = (title: string, children: () => VNode[] = () => []) =>
  h(PdfView, { bookmark: title, break: true }, () => [h(PdfText, null, () => title), ...children()])

const round = (value: number) => Math.round(value * 100) / 100

/**
 * The runs of one page with text, grouped into lines from the top. pdf.js
 * adds empty runs and a space run over the gap of the leader; they are left
 * out.
 */
const linesOf = (parsed: ParsedPdf, page = 1): { y: number, runs: ParsedPdfTextRun[] }[] => {
  const lines = new Map<number, ParsedPdfTextRun[]>()
  for (const run of parsed.pages[page - 1]!.textRuns.filter(item => item.text.trim() !== '')) {
    const y = round(PAGE_HEIGHT - run.y)
    lines.set(y, [...lines.get(y) ?? [], run])
  }
  return [...lines].sort(([a], [b]) => a - b).map(([y, runs]) => ({ y, runs: runs.sort((a, b) => a.x - b.x) }))
}

/** Each contents line as its title and its page number (the last run). */
const entriesOf = (parsed: ParsedPdf, page = 1): [string, string][] => linesOf(parsed, page).map(({ runs }) =>
  [runs.slice(0, -1).map(run => run.text).join('').trim(), runs.at(-1)!.text])

/** The page whose runs hold `text` first. */
const pageOf = (parsed: ParsedPdf, text: string, after = 1): number | undefined =>
  parsed.pages.find(page => page.number > after && page.textRuns.some(run => run.text === text))?.number

describe('PdfContents', () => {
  // The outline is the one source: rich text headings with `bookmarks`, a
  // bookmarked text and nested views, in tree order, with the page each
  // starts on. Catches a missing, doubled or misordered entry, a wrong page,
  // and an entry for a heading without a bookmark.
  it('lists the outline in order with the page of each entry', async () => {
    const { parsed } = await render(() => [
      h(PdfContents),
      h(PdfView, { break: true }, () => [
        h(PdfRichText, { bookmarks: true, html: '<h1>Peat</h1><p>Bogs hold water.</p><h2>Carbon</h2><p>Peat stores carbon.</p>' }),
        h(PdfText, { tag: 'h2' }, () => 'Not listed'),
      ]),
      heading('Methods', { break: true }),
      h(PdfView, { break: true }, () => h(PdfText, null, () => 'Filler')),
      h(PdfView, { break: true }, () => heading('Results')),
    ])
    expect(entriesOf(parsed)).toEqual([['Peat', '2'], ['Carbon', '2'], ['Methods', '3'], ['Results', '5']])
  }, 30_000)

  // The outline nests a bookmark under its nearest bookmarked ancestor; the
  // contents lists the same tree, indented 1.5em per level, and `levels`
  // leaves the deeper ones out. At 9 and 12 pt the indent is 13.5 and 18 pt.
  // Catches a flat list, `levels` ignored, and an indent in points.
  it.each([
    [10, 3, [['A', 40], ['A.1', 55], ['A.1.a', 70], ['B', 40]]],
    [10, 2, [['A', 40], ['A.1', 55], ['B', 40]]],
    [9, 1, [['A', 40], ['B', 40]]],
    [12, 2, [['A', 40], ['A.1', 58], ['B', 40]]],
  ] as const)('indents each level by 1.5em (%s pt, levels %s)', async (fontSize, levels, expected) => {
    const { parsed } = await render(() => [
      h(PdfContents, { levels }),
      chapter('A', () => [h(PdfView, { bookmark: 'A.1' }, () => heading('A.1.a'))]),
      chapter('B'),
    ], { fontSize })
    expect(linesOf(parsed).map(({ runs }) => [runs[0]!.text, round(runs[0]!.x)])).toEqual(expected)
  })

  // 60 entries make the contents two pages long, which moves every chapter
  // after it; the numbers of the first pass would all be wrong. Each
  // number's leader takes up any change of its width, so the second pass
  // lays out the same pages and the loop ends there. Catches pass-1 numbers printed, and a contents that
  // needs more passes than that.
  it('prints the right numbers when the contents itself fills pages', async () => {
    const titles = Array.from({ length: 60 }, (_, index) => `Chapter ${index + 1}`)
    const { parsed, passes } = await render(() => [h(PdfContents), ...titles.map(title => chapter(title))])
    const entries = [...entriesOf(parsed, 1), ...entriesOf(parsed, 2)]
    expect(entries.map(([title]) => title)).toEqual(titles)
    expect(entries.map(([title, page]) => Number(page) === pageOf(parsed, title, 2))).toEqual(titles.map(() => true))
    expect(entries[0]![1]).toBe('3')
    expect(passes).toBe(2)
  })

  // Each entry is one link to its place: an id of its own, or the reserved
  // one for a node without. Two contents list the same entries with the same
  // destinations: one id per listed node, not one per contents. Catches dead
  // or doubled destinations and colliding generated ids.
  it('links every entry to its destination, once per listed node', async () => {
    const { parsed, bytes } = await render(() => [
      h(PdfContents),
      h(PdfContents, { levels: 1 }),
      chapter('One', () => [heading('One.a')]),
      h(PdfView, { id: 'two', bookmark: 'Two', break: true }, () => h(PdfText, null, () => 'Two')),
    ])
    expect(parsed.links.map(link => link.destination)).toEqual([
      '__nuxtPdfContents-1', '__nuxtPdfContents-2', 'two',
      '__nuxtPdfContents-1', 'two',
    ])
    const names = [...new Set(Buffer.from(bytes).toString('latin1').match(/\((?:__nuxtPdfContents-\d+|two)\)/g))]
    expect(names.sort()).toEqual(['(__nuxtPdfContents-1)', '(__nuxtPdfContents-2)', '(two)'])
  })

  // The page numbers end at the right edge, and the leader runs on the
  // baseline from 0.3em (3 pt) after the end of the title's last line to
  // 0.3em before the number. A title that wraps runs to the right edge (no
  // reserved number column) and keeps its number on its last line, the
  // link's area around both. Catches a ragged page column, the stub of the
  // row layout (a wrapped title's leader started at the width of its widest
  // line, 509.71), a leader over the title or the number, a number beside
  // the first line, and an entry cut into two links.
  it('runs the leader from the end of the title to the page number at the right edge', async () => {
    const long = 'A title long enough to wrap onto a second line of the contents, because it does not end before the page column'
    const { parsed, bytes } = await render(() => [h(PdfContents), chapter('Short'), chapter(long)])
    const lines = linesOf(parsed)
    expect(lines.map(({ runs }) => runs.map(run => [run.text, round(run.x), round(run.width)]))).toEqual([
      [['Short', 40, 26.31], ['2', 549.72, 5.56]],
      [[long.slice(0, -' column'.length), 40, 490.05]],
      [['column', 40, 35.56], ['3', 549.72, 5.56]],
    ])
    expect(round(549.72 + 5.56)).toBe(RIGHT)

    // pdf.js gives a stroke's box half the 0.75 pt line width beyond each
    // end; the line's lower edge is the baseline.
    const strokes = (await readPaint(bytes)).filter(({ page, rect: [, y1, , y2] }) => page === 1 && Math.abs(y2 - y1 - 0.75) < 0.01)
    expect(strokes.map(({ rect: [x1, y1, x2] }) => [round(x1 + 0.375), round(x2 - 0.375), round(PAGE_HEIGHT - y1)])).toEqual([
      [round(66.31 + 3), round(549.72 - 3), 55],
      [round(75.56 + 3), round(549.72 - 3), 83],
    ])
    // The two leaders start at different x, but their dots share one grid
    // from the page's left edge (D43): each dash phase moves its pattern
    // back to that grid. A pattern started at each leader's own start (phase
    // 0) leaves the second leader's dots 0.64 pt off that grid.
    const period = 0.75 * 2.2
    const phases = [...new TextDecoder('latin1').decode(bytes).matchAll(/\[[\d. ]+\] ([\d.]+) d/g)].map(match => Number(match[1]))
    const offGrid = strokes.map(({ rect: [x1] }, index) => {
      const offset = (((x1 + 0.375 - phases[index]!) % period) + period) % period
      return round(Math.min(offset, period - offset))
    })
    expect(offGrid).toEqual([0, 0])
    expect(parsed.pages[0]!.annotations.filter(annotation => annotation.subtype === 'Link')).toHaveLength(2)
  })

  // A link starts in link blue and underlined (layout/styles/resolve-styles.ts).
  // An entry takes the text colour it inherits at the place of the contents,
  // black by default, and no underline. Every text of these documents has
  // that one colour, so the file holds one fill colour; with no leader, the
  // only boxes painted on the contents page are the link areas. Catches an
  // entry printed in link blue or underlined.
  it.each([
    ['black by default', {}, '0 0 0 rg'],
    ['the colour set on the page', { color: '#336699' }, '0.2 0.4 0.6 rg'],
  ] satisfies [string, PdfStyle, string][])('prints the entries in %s, without an underline', async (_label, pageStyle, fill) => {
    const { parsed, bytes } = await render(() => [h(PdfContents, { leader: 'none' }), chapter('One'), chapter('Two')], pageStyle)
    const fills = new Set(new TextDecoder('latin1').decode(bytes).match(/[\d.]+ [\d.]+ [\d.]+ rg/g))
    expect([...fills]).toEqual([fill])
    const links = parsed.pages[0]!.annotations.filter(annotation => annotation.subtype === 'Link')
    expect(links).toHaveLength(2)
    expect((await readPaint(bytes)).filter(({ page }) => page === 1)).toHaveLength(links.length)
  })

  // `contents: false` keeps an outline entry out of the contents, and the
  // entries below it move up a level. Catches the opt-out reaching the
  // outline, being ignored, or dropping the entries below it.
  it('leaves out an entry with contents: false, which stays in the outline', async () => {
    const { parsed } = await render(() => [
      h(PdfText, { bookmark: { title: 'Contents', contents: false } }, () => 'Contents'),
      h(PdfContents),
      h(PdfView, { bookmark: { title: 'Part', contents: false }, break: true }, () => heading('Inner')),
    ])
    expect(linesOf(parsed).map(({ runs }) => [runs.map(run => run.text).join(' '), round(runs[0]!.x)])).toEqual([['Contents', 40], ['Inner 2', 40]])
    expect(parsed.outline).toEqual([{ title: 'Contents', children: [] }, { title: 'Part', expanded: false, children: [{ title: 'Inner', children: [] }] }])
  })

  // An entry never splits: in two columns, each entry with its number stays
  // in one column, and the contents fills both. Catches an entry cut between
  // columns, a title in one column and its number in the next.
  it('fills two columns with whole entries', async () => {
    // Seven entries of four lines (two lines stay together by the default
    // orphans and widows): balanced columns of 14 lines would cut the fourth
    // entry after its second line, its number in the second column.
    const titles = Array.from({ length: 7 }, (_, index) => `Entry ${index + 1}: restoring drained peatland by blocking the ditches, raising the water table and returning the mosses that build new peat over the decades that follow`)
    const { parsed } = await render(() => [
      h(PdfView, { style: { columnCount: 2, columnGap: 20 } }, () => h(PdfContents)),
      ...titles.map(title => chapter(title)),
    ])
    const runs = parsed.pages[0]!.textRuns.filter(run => run.text.trim() !== '')
    const column = (run: ParsedPdfTextRun) => run.x < 297.64 ? 1 : 2
    // In reading order, each column starts with the first line of an entry
    // and ends with a page number, and every entry keeps its number.
    for (const number of [1, 2]) {
      const inColumn = runs.filter(run => column(run) === number).sort((a, b) => b.y - a.y || a.x - b.x)
      expect(inColumn[0]?.text).toMatch(/^Entry \d+:/)
      expect(inColumn.at(-1)?.text).toMatch(/^\d+$/)
    }
    expect(runs.filter(run => /^\d+$/.test(run.text))).toHaveLength(titles.length)
  })

  // Catches a contents that prints in the place a typed error belongs: one
  // that would repeat on every page, sit in a link or a row that cannot
  // split, list nothing, or take a value it cannot honour.
  it.each([
    ['in a fixed node', () => [h(PdfView, { fixed: true }, () => h(PdfContents)), heading('A')],
      '<PdfContents> cannot be inside a fixed node (a <PdfTableHeader> is one): a fixed node repeats on every page, and so would the contents. Move it into the page flow.'],
    ['in a text', () => [h(LooseText, null, () => h(PdfContents)), heading('A')],
      'Invalid PDF nesting: <PdfText> cannot contain <PdfContents>.'],
    ['in a link', () => [h(PdfLink, { href: 'https://example.test' }, () => h(PdfView, null, () => h(PdfContents))), heading('A')],
      '<PdfContents> cannot be inside <PdfLink>: each entry is a link to its place, and a link cannot hold a link. Move it out of the link.'],
    ['in a table cell', () => [h(PdfTable, { columns: [1] }, () => h(PdfTableRow, null, () => h(PdfTableCell, null, () => h(PdfContents)))), heading('A')],
      '<PdfContents> cannot be inside <PdfTableCell>: a table row does not split between its entries. Put the contents before or after the table.'],
    ['without a bookmark in the document', () => [h(PdfContents), h(PdfText, { tag: 'h1' }, () => 'A')],
      '<PdfContents> has no entries: it lists the outline, and no node in the document has a "bookmark". Give the headings a bookmark, such as <PdfText tag="h1" bookmark="Introduction">, or set "bookmarks" on <PdfRichText>.'],
    ['with levels 0', () => [h(LooseContents, { levels: 0 }), heading('A')],
      '<PdfContents> requires "levels" to be a whole number from 1 to 6: the outline levels it lists. Got 0.'],
    ['with levels 2.5', () => [h(LooseContents, { levels: 2.5 }), heading('A')], 'requires "levels" to be a whole number from 1 to 6'],
    ['with levels 7', () => [h(LooseContents, { levels: 7 }), heading('A')], 'requires "levels" to be a whole number from 1 to 6'],
    ['with a style of its own', () => [h(LooseContents, { style: { fontSize: 9 } }), heading('A')],
      '<PdfContents> takes no style or class: it is replaced by its entries. Style the entries with "styles", such as "styles.entry", or put the contents in a <PdfView> with the style.'],
    ['with an unknown leader', () => [h(LooseContents, { leader: 'line' }), heading('A')],
      '<PdfContents> requires "leader" to be "dots" or "none". Got "line".'],
    ['with an unknown style part', () => [h(LooseContents, { styles: { number: { color: 'red' } } }), heading('A')],
      '<PdfContents> "styles" has no part "number". Use entry, title, leader, page, level1, level2, level3, level4, level5, level6.'],
    ['with an invalid style', () => [h(LooseContents, { styles: { title: { color: 'bleu' } } }), heading('A')], '<PdfContents styles.title> :style value "bleu" for "color" is invalid'],
    // The title and the number are text inside the entry's line, and the
    // leader a `PdfLeader` (the row layout took box keys for all three).
    ['with a width for the page number', () => [h(LooseContents, { styles: { page: { width: '3em' } } }), heading('A')],
      '<PdfContents> "styles.page" does not take the style "width": the page number is text inside the entry\'s line. It takes backgroundColor, color, fontFamily,'],
    ['with flexShrink on the title', () => [h(LooseContents, { styles: { title: { flexShrink: 1 } } }), heading('A')],
      '<PdfContents> "styles.title" does not take the style "flexShrink": the title is text inside the entry\'s line.'],
    ['with flexGrow on the leader', () => [h(LooseContents, { styles: { leader: { flexGrow: 1 } } }), heading('A')],
      '<PdfContents styles.leader> does not take the style "flexGrow". A leader takes borderBottomStyle, borderBottomWidth, borderBottomColor, marginLeft, marginRight; its line sits on the baseline.'],
    ['with marginBottom on the leader', () => [h(LooseContents, { styles: { leader: { marginBottom: 2 } } }), heading('A')],
      '<PdfContents styles.leader> does not take the style "marginBottom".'],
    ['with a bookmark contents that is not false', () => [h(PdfContents), h(LooseText, { bookmark: { title: 'A', contents: 'no' } }, () => 'A')],
      '<PdfText> requires "bookmark" to be a title string or { title: string, expanded?: boolean, contents?: false }. Got an object.'],
    ['with an id that starts with the reserved prefix', () => [h(PdfContents), h(PdfText, { id: '__nuxtPdfContents-1', bookmark: 'A' }, () => 'A')],
      '<PdfText id="__nuxtPdfContents-1"> has an id that starts with "__nuxtPdfContents-", which the entries of a <PdfContents> use. Use another id.'],
  ] satisfies [string, () => VNode[], string][])('fails at mount %s', async (_label, content, message) => {
    await expect(render(content)).rejects.toMatchObject({ code: 'PDF_TREE_INVALID', message: expect.stringContaining(message) })
  })
})
