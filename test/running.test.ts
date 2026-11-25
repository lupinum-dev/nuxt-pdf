import { defineComponent, h, type Component, type VNode, type VNodeChild } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { installPdfCanvasGlobals, parsePdf, type ParsedPdf } from '../src/test/pdf'

installPdfCanvasGlobals()

// The failure rows pass values that the typed props reject.
const PLAIN: Readonly<Record<keyof typeof PDF_COMPONENTS, Component>> = PDF_COMPONENTS
const { PdfDocument, PdfFootnote, PdfPage, PdfPageNumber, PdfPageRef, PdfRunningText, PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfText, PdfView } = PLAIN

// A5 with 40 pt padding and 10 pt text: about 41 lines of 12 pt fill a page.
const PAGE = { size: 'A5', style: { padding: 40, fontSize: 10, lineHeight: 1.2 } }
const PAGE_HEIGHT = 595.28
// Table rows of 20 pt under the header line (18 pt) and the table header
// (20 pt): 23 fit in the content height of 515.28 pt.
const ROWS_ON_PAGE_1 = 23

const round = (value: number) => Math.round(value * 100) / 100

/** A fixed header that prints the running values `names` in brackets, such as "[One|1.1]". */
const header = (names: string[] = ['chapter']) => h(PdfText, { fixed: true, style: { marginBottom: 6 } }, () =>
  ['[', ...names.flatMap((name, index) => [index > 0 ? '|' : '', h(PdfRunningText, { name })]), ']'])

/** `count` lines of body text. */
const lines = (count: number, label = 'Body') => Array.from({ length: count }, (_, index) => h(PdfText, { key: `${label}${index}` }, () => `${label} line ${index + 1}`))

/** A document of one `PdfPage` per entry: its content, or its content and its own props. */
const render = async (pages: (() => VNodeChild)[] | [Record<string, unknown>, () => VNodeChild][]) => {
  const mounted = await mountPdfComponent(defineComponent(() => () => h(PdfDocument, { creationDate: new Date(0) }, () =>
    pages.map((entry, index) => typeof entry === 'function'
      ? h(PdfPage, { key: index, ...PAGE }, entry)
      : h(PdfPage, { key: index, ...PAGE, ...entry[0] }, entry[1])))))
  try {
    const result = await renderPlainDocument(mounted.document, { compress: false })
    return { ...result, parsed: await parsePdf(result.bytes) }
  }
  finally {
    mounted.unmount()
  }
}

/** The header of each page: the text of its line that starts with "[". */
const headersOf = (parsed: ParsedPdf): string[] => parsed.pages.map((page) => {
  const top = page.textRuns.find(run => run.text.startsWith('['))
  return page.textRuns.filter(run => top !== undefined && Math.abs(run.y - top.y) < 0.5).map(run => run.text).join('')
})

describe('running values', () => {
  // The start rule: a page shows the value set at its very top (Two on page
  // 3, set by the first node of its PdfPage), otherwise the last value set
  // before it. Two starts in the middle of page 2, so page 2 still shows One
  // and page 3, where Two goes on, shows Two. Catches the value of the first
  // setter on a page (page 2 would show Two), a value lost at a page break or
  // a PdfPage boundary, and values missing from the round with the total.
  it('shows the value set at the top of a page, else the last one before it', async () => {
    const { parsed } = await render([
      () => [header(), h(PdfText, { running: 'chapter' }, () => 'One'), ...lines(50, 'One'), h(PdfText, { running: 'chapter' }, () => 'Two'), ...lines(50, 'Two')],
      () => [header(), h(PdfText, { running: 'chapter' }, () => 'Three'), ...lines(3, 'Three')],
    ])
    expect(headersOf(parsed)).toEqual(['[One]', '[One]', '[Two]', '[Three]'])
  })

  // Catches a token that prints a stale value, or the name, before any text
  // sets one.
  it('prints nothing before the first value', async () => {
    const { parsed } = await render([
      () => [header(), ...lines(10, 'Intro')],
      () => [header(), h(PdfView, null, () => h(PdfView, null, () => h(PdfText, { running: 'chapter' }, () => 'One'))), ...lines(3)],
    ])
    expect(headersOf(parsed)).toEqual(['[]', '[One]'])
  })

  // The short form gives the value its own text; the value of the long form
  // is the plain text of the setter, nested texts included and spaces
  // joined. Catches the short form ignored, and a value with the line breaks
  // of the template.
  it('takes the text of the short form, or the plain text of the setter', async () => {
    const { parsed } = await render([
      () => [header(), h(PdfText, { running: { name: 'chapter', text: 'Methods' } }, () => 'Methods of restoring drained peatlands'), ...lines(3)],
      () => [header(), h(PdfText, { running: 'chapter' }, () => ['Results\n   of ', h(PdfText, { style: { fontWeight: 'bold' } }, () => 'rewetting')]), ...lines(3)],
    ])
    expect(headersOf(parsed)).toEqual(['[Methods]', '[Results of rewetting]'])
  })

  // A setter that starts low on page 1 and goes on to page 2: page 1 keeps
  // the earlier value (it is not at the top), page 2 shows the setter's.
  // Catches the value of a setter shown on the page where it starts below
  // the top, and a value lost on the continuation page.
  it('shows the value of a setter that goes on from the page before', async () => {
    const long = Array.from({ length: 12 }, (_, index) => `Sentence ${index + 1} of a long chapter title that wraps.`).join(' ')
    const { parsed } = await render([
      () => [header(), h(PdfText, { running: 'chapter' }, () => 'Before'), ...lines(36), h(PdfText, { running: { name: 'chapter', text: 'Long' }, orphans: 1, widows: 1 }, () => long), ...lines(3, 'After')],
    ])
    const page2 = parsed.pages[1]!.textRuns.map(run => run.text).join(' ')
    expect(page2).toContain('Sentence 12')
    expect(page2).not.toContain('Sentence 1 ')
    expect(headersOf(parsed)).toEqual(['[Before]', '[Long]'])
  })

  // Each name has its own value, each by its own rule: on page 2 the section
  // 1.2 is at the top and the chapter One is carried; on page 3 the chapter
  // Two is at the top and the section 1.2 is carried (2.1 is not at the top).
  // Catches values of one name that overwrite another.
  it('keeps one value for each name, each by its own rule', async () => {
    const chapter = (title: string, sections: string[]) => [
      h(PdfText, { running: 'chapter', break: true }, () => title),
      ...sections.flatMap(section => [h(PdfText, { running: 'section', break: section !== sections[0] }, () => section), ...lines(3, section)]),
    ]
    const { parsed } = await render([
      () => [header(['chapter', 'section']), ...chapter('One', ['1.1', '1.2']), ...chapter('Two', ['2.1'])],
    ])
    expect(headersOf(parsed)).toEqual(['[One|]', '[One|1.2]', '[Two|1.2]'])
  })

  // A chapter that goes on in a landscape PdfPage keeps its value there; the
  // next PdfPage that starts with a setter shows the new one. Catches values
  // reset at a PdfPage boundary.
  it('carries the value into the next PdfPage', async () => {
    const { parsed } = await render([
      [{}, () => [header(), h(PdfText, { running: 'chapter' }, () => 'One'), ...lines(3)]],
      [{ orientation: 'landscape' }, () => [header(), ...lines(3, 'Table')]],
      [{}, () => [header(), h(PdfText, { running: 'chapter' }, () => 'Two'), ...lines(3)]],
    ])
    expect(parsed.pages.map(page => page.width > page.height)).toEqual([false, true, false])
    expect(headersOf(parsed)).toEqual(['[One]', '[One]', '[Two]'])
  })

  // A ledger: the table header repeats on every page and is fixed, so it does
  // not hide the top node. The group row "Account 5000" is the first body
  // row of page 2; its first cell sets the value, so page 2 names the new
  // group. Catches a top walk that stops at the repeated header.
  it('takes the first body row of a table under its repeated header', async () => {
    const row = (cells: VNodeChild[]) => h(PdfTableRow, { style: { height: 20 } }, () => cells.map(cell => h(PdfTableCell, () => cell)))
    const group = (account: string, count: number) => [
      row([h(PdfText, { running: 'account' }, () => account), 'Total']),
      ...Array.from({ length: count }, (_, index) => row([`Entry ${account} ${index + 1}`, '10.00'])),
    ]
    const { parsed } = await render([
      () => [header(['account']), h(PdfTable, { columns: [3, 1] }, () => [
        h(PdfTableHeader, { style: { height: 20 } }, () => [h(PdfTableCell, () => 'Item'), h(PdfTableCell, () => 'Amount')]),
        ...group('Account 4000', ROWS_ON_PAGE_1 - 1),
        ...group('Account 5000', 3),
      ])],
    ])
    const page2 = parsed.pages[1]!.textRuns.map(run => run.text).filter(text => text.trim() !== '')
    expect(page2.slice(0, 4)).toEqual(['[Account 5000]', 'Item', 'Amount', 'Account 5000'])
    expect(headersOf(parsed)).toEqual(['[Account 4000]', '[Account 5000]'])
  })

  // A fixed header in the flow takes the height of its value on each page:
  // one line on page 1, two lines on page 2, where the next chapter starts
  // at the top. The flow of page 2 starts one line (12 pt) lower than on
  // page 1, below the second header line, and its last line still ends in
  // the content box. Catches a page split with the room of another page's
  // header: painted with its own header, the full page would run past its
  // bottom.
  it('gives the flow the room of the header of its own page', async () => {
    const long = 'Restoration of drained and cut-over raised bogs in the lowlands of the north and east'
    const { parsed } = await render([
      () => [header(), h(PdfText, { running: 'chapter' }, () => 'Short'), ...lines(20), h(PdfText, { running: { name: 'chapter', text: long }, break: true }, () => 'Chapter 2'), ...lines(50, 'Two')],
    ])
    const topOf = (page: number, text: string) => round(PAGE_HEIGHT - parsed.pages[page]!.textRuns.find(run => run.text === text)!.y)
    const headerLines = new Set(parsed.pages[1]!.textRuns.filter(run => topOf(1, 'Chapter 2') - round(PAGE_HEIGHT - run.y) > 0).map(run => round(run.y)))
    expect(headerLines.size).toBe(2)
    expect(round(topOf(1, 'Chapter 2') - topOf(0, 'Short'))).toBe(12)
    expect(Math.max(...parsed.pages[1]!.textRuns.map(run => PAGE_HEIGHT - run.y))).toBeLessThanOrEqual(PAGE_HEIGHT - 40)
  })

  // A chapter that starts a PdfPage with a long title: the header of its
  // first page takes two lines, and the page is split with that room. Page 1
  // holds 39 body lines, 12 pt apart. Catches a first page laid out for the
  // split without its values: split with a one-line header, it takes one
  // line more, and yoga squeezes its lines to fit.
  it('gives the first page of a PdfPage the room of its own header', async () => {
    const long = 'Restoration of drained and cut-over raised bogs in the lowlands of the north and east'
    const { parsed } = await render([
      () => [header(), h(PdfText, { running: { name: 'chapter', text: long } }, () => 'Chapter 1'), ...lines(60)],
    ])
    const body = parsed.pages[0]!.textRuns.filter(run => run.text.startsWith('Body line')).map(run => run.y)
    expect(body.length).toBe(39)
    expect(new Set(body.slice(1).map((y, index) => round(body[index]! - y)))).toEqual(new Set([12]))
  })

  // A page with wrap={false} sets its values like any page: Two, set below
  // the top of page 1, is the value before page 2. Catches the setters of a
  // page that is laid out whole not counted.
  it('counts the setters of a page with wrap={false}', async () => {
    const { parsed } = await render([
      [{ wrap: false }, () => [header(), h(PdfText, { running: 'chapter' }, () => 'One'), ...lines(3), h(PdfText, { running: 'chapter' }, () => 'Two'), ...lines(3, 'More')]],
      [{}, () => [header(), ...lines(3, 'Next')]],
    ])
    expect(headersOf(parsed)).toEqual(['[One]', '[Two]'])
  })

  // Catches a running value that is set or printed where the result would be
  // wrong: set on every page from a fixed node, set from a note outside the
  // flow, with a value that holds a page token or a note, or with a value or
  // name that cannot be read.
  it.each([
    ['set in a fixed node', () => [h(PdfView, { fixed: true }, () => h(PdfText, { running: 'chapter' }, () => 'Head'))],
      '<PdfText> with "running" cannot be fixed or inside a fixed node (a <PdfTableHeader> is one): a fixed node repeats on every page, and would set the value on every page. Put the text that sets the value in the page flow, and <PdfRunningText> in the fixed node.'],
    ['set on a fixed text', () => [h(PdfText, { fixed: true, running: 'chapter' }, () => 'Fixed')],
      '<PdfText> with "running" cannot be fixed or inside a fixed node (a <PdfTableHeader> is one)'],
    ['set in a table header', () => [h(PdfTable, { columns: [1] }, () => h(PdfTableHeader, () => h(PdfTableCell, () => h(PdfText, { running: 'chapter' }, () => 'Head'))))],
      '<PdfText> with "running" cannot be fixed or inside a fixed node (a <PdfTableHeader> is one)'],
    ['set in a node with pages', () => [h(PdfView, { fixed: true, pages: 'first' }, () => h(PdfText, { running: 'chapter' }, () => 'Head'))],
      '<PdfText> with "running" cannot be fixed or inside a fixed node (a <PdfTableHeader> is one)'],
    ['set in a footnote note', () => [h(PdfText, () => ['Body', h(PdfFootnote, () => h(PdfText, { running: 'chapter' }, () => 'Note'))])],
      '<PdfText> with "running" cannot be inside <PdfFootnote>: a note is laid out at the bottom of its page, outside the flow that sets the values. Put the text that sets the value in the page flow.'],
    ['with a footnote in the setter', () => [h(PdfText, { running: 'chapter' }, () => ['One', h(PdfFootnote, () => 'Note.')])],
      '<PdfFootnote> cannot be inside a <PdfText> with "running": the running value is the plain text of that text, and a note is not part of it. Put the footnote in another text.'],
    ['with a page number in the setter', () => [h(PdfText, { running: 'chapter' }, () => ['Page ', h(PdfPageNumber)])],
      '<PdfPageNumber> cannot be inside a <PdfText> with "running": the running value is the plain text of that text, and a page token has no text when the value is set. Put the token in another text.'],
    ['with a running text in the setter', () => [h(PdfText, { running: 'chapter' }, () => ['One ', h(PdfRunningText, { name: 'part' })])],
      '<PdfRunningText> cannot be inside a <PdfText> with "running"'],
    ['with a number as the value', () => [h(PdfText, { running: 3 }, () => 'One')],
      '<PdfText> requires "running" to be a name, such as "chapter", or { name: string, text: string }. Got 3.'],
    ['with an empty name', () => [h(PdfText, { running: ' ' }, () => 'One')], '<PdfText> requires "running" to be a name'],
    ['with a short form without text', () => [h(PdfText, { running: { name: 'chapter' } }, () => 'One')], '<PdfText> requires "running" to be a name'],
    ['with a short form with another key', () => [h(PdfText, { running: { name: 'chapter', text: 'One', level: 1 } }, () => 'One')], '<PdfText> requires "running" to be a name'],
    ['printed without a name', () => [h(PdfText, { fixed: true }, () => h(PdfRunningText))],
      '<PdfRunningText> requires "name": the running value it prints, such as "chapter".'],
    ['printed with an empty name', () => [h(PdfText, { fixed: true }, () => h(PdfRunningText, { name: '' }))],
      '<PdfRunningText> requires "name" to name a running value, such as "chapter". Got "".'],
    ['printed in a footnote note', () => [h(PdfText, () => ['Body', h(PdfFootnote, () => h(PdfText, () => h(PdfRunningText, { name: 'chapter' })))])],
      '<PdfRunningText> cannot be inside <PdfFootnote>: the notes are laid out before the pages are known. Write the value in the note.'],
    ['printed in the flow', () => [h(PdfText, () => ['Chapter ', h(PdfRunningText, { name: 'chapter' })])],
      '<PdfRunningText> must be inside a fixed node, such as a header or a footer: in the flow, a running value could change the size of the text after the page is split. Put it in a fixed header or footer.'],
    ['printed with a name that no text sets', () => [header(['part'])],
      '<PdfRunningText> prints the running value "part", which no <PdfText> in the document sets. Correct the name, or set it with running="part" on a heading. When the texts that set it are optional, put the same v-if on <PdfRunningText>.'],
    ['set on a nested text', () => [h(PdfText, () => ['Part ', h(PdfText, { running: 'chapter' }, () => 'One')])],
      '<PdfText> with "running" cannot be nested inside another <PdfText>: pagination sees a nested text only as part of the lines of its parent. Put "running" on the outer text.'],
    ['printed in a nested text', () => [h(PdfText, { fixed: true }, () => ['Chapter ', h(PdfText, () => h(PdfRunningText, { name: 'chapter' }))])],
      '<PdfRunningText> is not supported in a <PdfText> nested inside another <PdfText>. Put it in the outer text.'],
    ['set on a fixed table row', () => [h(PdfTable, { columns: [1] }, () => h(PdfTableRow, { fixed: true, running: { name: 'chapter', text: 'Head' } }, () => h(PdfTableCell, () => 'Head')))],
      '<PdfTableRow> with "running" cannot be fixed or inside a fixed node (a <PdfTableHeader> is one)'],
    ['set on a table row by name only', () => [h(PdfTable, { columns: [1] }, () => h(PdfTableRow, { running: 'chapter' }, () => h(PdfTableCell, () => 'Row')))],
      '<PdfTableRow> requires "running" to be { name: string, text: string }: a row has no text of its own to set.'],
    ['printed with at="end" in a column', () => [h(PdfView, { style: { columnCount: 2 } }, () => h(PdfTable, { columns: [1] }, () => [
      h(PdfTableRow, { running: { name: 'chapter', text: 'Row' } }, () => h(PdfTableCell, () => 'Row')),
      h(PdfTableRow, { fixed: true }, () => h(PdfTableCell, () => h(PdfRunningText, { name: 'chapter', at: 'end' }))),
    ]))],
    '<PdfRunningText> with at="end" cannot be in a column: the value at the end of a page is a value of the whole page, and a fixed node in a column repeats in every column.'],
    ['printed with an unknown at', () => [h(PdfText, { fixed: true }, () => h(PdfRunningText, { name: 'chapter', at: 'last' }))],
      '<PdfRunningText> requires "at" to be "top", "before" or "end".'],
    ['printed in a text with other elements', () => [h(PdfText, { fixed: true }, () => [h(PdfRunningText, { name: 'chapter' }), h(PdfText, () => 'x')])],
      'A <PdfText> that contains <PdfRunningText> cannot contain other elements. Style the whole text, or put the other elements in a text of their own.'],
  ] satisfies [string, () => VNode[], string][])('fails at mount %s', async (_label, content, message) => {
    await expect(render([() => [h(PdfText, { running: 'chapter' }, () => 'Chapter'), ...content()]])).rejects.toMatchObject({ code: 'PDF_TREE_INVALID', message: expect.stringContaining(message) })
  })

  it('accepts a running value in a table cell', async () => {
    const { parsed } = await render([
      () => [header(), h(PdfTable, { columns: [1] }, () => h(PdfTableRow, () => h(PdfTableCell, () => h(PdfText, { running: 'chapter' }, () => 'Ledger'))))],
    ])
    expect(headersOf(parsed)).toEqual(['[Ledger]'])
  })
})

describe('carried values', () => {
  /** The running sums of 1, 2, 3, … as strings: what an author's formatter would give. */
  const sums = (count: number, prefix = '') => {
    let sum = 0
    return Array.from({ length: count }, (_, index) => `${prefix}${sum += index + 1}`)
  }

  /**
   * A ledger of 20 pt rows; each row sets `name` to its value. The row under
   * the header shows the value before the page on every page but the first,
   * the last row the value at the end of the page on every page but the last.
   */
  const ledger = (values: readonly string[], { name = 'net', label = 'Row', cell = (index: number): VNodeChild => String(index + 1) } = {}) => h(PdfTable, { columns: [3, 1] }, () => [
    h(PdfTableHeader, { style: { height: 20 } }, () => [h(PdfTableCell, () => 'Item'), h(PdfTableCell, () => 'Amount')]),
    h(PdfTableRow, { fixed: true, pages: 'continuation', style: { height: 20 } }, () => [h(PdfTableCell, () => 'Carried forward'), h(PdfTableCell, () => h(PdfRunningText, { name, at: 'before' }))]),
    ...values.map((text, index) => h(PdfTableRow, { key: `${label}${index}`, style: { height: 20 }, running: { name, text } }, () => [h(PdfTableCell, () => `${label} ${index + 1}`), h(PdfTableCell, () => cell(index))])),
    h(PdfTableRow, { fixed: true, pages: 'not-last', style: { height: 20 } }, () => [h(PdfTableCell, () => 'Carried over'), h(PdfTableCell, () => h(PdfRunningText, { name, at: 'end' }))]),
  ])

  /** The text on the line of `label` on each page, without the label; '-' where the line is not shown. */
  const lineOf = (parsed: ParsedPdf, label: string): string[] => parsed.pages.map((page) => {
    const run = page.textRuns.find(candidate => candidate.text === label)
    return run === undefined ? '-' : page.textRuns.filter(other => other !== run && Math.abs(other.y - run.y) < 0.5).map(other => other.text).join('').trim()
  })

  // The carried values of a ledger over two or three pages: the row under
  // the header shows the sum of the pages before (276 = 1 + … + 23), the last
  // row the sum through its page, and neither shows where the table starts
  // or ends. The 'continuation' row takes no room on page 1, so that page
  // holds 23 rows; the page builder knows each page's end while it fills, so
  // the 'not-last' row needs no second pass. Catches the value at the page top
  // printed for `before` (p2 would show 276) or the value before the page
  // for `end`, a value from another page, and a carry row on the first part
  // or on the last one.
  it.each([
    { label: 'starts at a page top', before: [], count: 60, forward: ['-', '276', '1035'], over: ['276', '1035', '-'] },
    { label: 'starts in the middle of a page', before: [h(PdfText, { style: { height: 300 } }, () => 'Before')], count: 40, forward: ['-', '36', '465'], over: ['36', '465', '-'] },
    { label: 'fits one page', before: [], count: 10, forward: ['-'], over: ['-'] },
  ])('carries the sum of a ledger that $label', async ({ before, count, forward, over }) => {
    const { parsed, passes } = await render([() => [...before, ledger(sums(count))]])
    expect({ forward: lineOf(parsed, 'Carried forward'), over: lineOf(parsed, 'Carried over'), passes }).toEqual({ forward, over, passes: 1 })
  })

  // A row that splits counts on the page of its first part: the end of page
  // 1 and the start of page 2 both show its value. Catches a split row that
  // sets its value only where it ends.
  it('counts a row that splits on the page of its first part', async () => {
    const tall = h(PdfTableRow, { key: 'tall', wrap: true, running: { name: 'net', text: 'Split' } }, () => [
      h(PdfTableCell, () => h(PdfText, () => Array.from({ length: 15 }, (_, index) => `Tall line ${index + 1}`).join('\n'))),
      h(PdfTableCell, () => '9'),
    ])
    const { parsed } = await render([() => [h(PdfTable, { columns: [3, 1] }, () => [
      h(PdfTableRow, { fixed: true, pages: 'continuation', style: { height: 20 } }, () => [h(PdfTableCell, () => 'Carried forward'), h(PdfTableCell, () => h(PdfRunningText, { name: 'net', at: 'before' }))]),
      ...sums(20).map((text, index) => h(PdfTableRow, { key: index, style: { height: 20 }, running: { name: 'net', text } }, () => [h(PdfTableCell, () => `Row ${index + 1}`), h(PdfTableCell, () => '1')])),
      tall,
      h(PdfTableRow, { fixed: true, pages: 'not-last', style: { height: 20 } }, () => [h(PdfTableCell, () => 'Carried over'), h(PdfTableCell, () => h(PdfRunningText, { name: 'net', at: 'end' }))]),
    ])]])
    const tallPages = parsed.pages.flatMap((page, index) => page.textRuns.some(run => run.text.startsWith('Tall line')) ? [index + 1] : [])
    expect({ tallPages, forward: lineOf(parsed, 'Carried forward'), over: lineOf(parsed, 'Carried over') }).toEqual({ tallPages: [1, 2], forward: ['-', 'Split'], over: ['Split', '-'] })
  })

  // Two ledgers with the same name, the second after the first: each shows
  // its own values, since a value is the last one set. Catches a value of
  // the first ledger at the start of the second one's next page.
  it('shows the values of the second ledger with the same name', async () => {
    const { parsed } = await render([() => [ledger(sums(30, 'A'), { label: 'First' }), ledger(sums(30, 'B'), { label: 'Second' })]])
    expect({ forward: lineOf(parsed, 'Carried forward'), over: lineOf(parsed, 'Carried over') }).toEqual({ forward: ['-', 'A276', 'B91'], over: ['A276', 'B91', '-'] })
  })

  // Net set by the row, VAT by a text in its cell: both carry, each by its
  // own name. Catches a second name that replaces the first.
  it('carries two names of one ledger', async () => {
    const vat = sums(30, 'V')
    const { parsed } = await render([() => [h(PdfTable, { columns: [3, 1, 1] }, () => [
      h(PdfTableRow, { fixed: true, pages: 'continuation' }, () => [h(PdfTableCell, () => 'Carried forward'), h(PdfTableCell, () => h(PdfText, () => [h(PdfRunningText, { name: 'net', at: 'before' })])), h(PdfTableCell, () => h(PdfRunningText, { name: 'vat', at: 'before' }))]),
      ...sums(30, 'N').map((text, index) => h(PdfTableRow, { key: index, style: { height: 20 }, running: { name: 'net', text } }, () => [h(PdfTableCell, () => `Row ${index + 1}`), h(PdfTableCell, () => '1'), h(PdfTableCell, () => h(PdfText, { running: { name: 'vat', text: vat[index]! } }, () => '0.19'))])),
    ])]])
    expect(lineOf(parsed, 'Carried forward')).toEqual(['-', 'N325 V325'])
  })

  // A page reference makes the loop run for the destinations too; the
  // values and the hidden carry rows hold in the pass that is kept. Catches
  // the last pages lost when another fact also changes.
  it('keeps the values in a document with a page reference', async () => {
    const { parsed, passes } = await render([() => [h(PdfText, () => ['Ends on page ', h(PdfPageRef, { to: 'end' })]), ledger(sums(40)), h(PdfText, { id: 'end' }, () => 'End')]])
    expect({ ref: parsed.pages[0]!.textRuns.find(run => run.text.startsWith('Ends on page'))?.text, forward: lineOf(parsed, 'Carried forward'), over: lineOf(parsed, 'Carried over'), passes })
      .toEqual({ ref: 'Ends on page 2', forward: ['-', '276'], over: ['276', '-'], passes: 2 })
  })

  // A value not known yet prints the longest value of its name: an 'auto'
  // column is measured with it, so a long value carried later stays on one
  // line. Catches a column measured with an empty token, in which the long
  // value wraps.
  it('measures an auto column with the longest value', async () => {
    const long = '1,234,567.89'
    const { parsed } = await render([() => [h(PdfTable, { columns: [1, 'auto'] }, () => [
      h(PdfTableRow, { fixed: true }, () => [h(PdfTableCell, () => 'Carried forward'), h(PdfTableCell, () => h(PdfRunningText, { name: 'net', at: 'before' }))]),
      ...Array.from({ length: 60 }, (_, index) => h(PdfTableRow, { key: index, running: { name: 'net', text: index === 40 ? long : '1' } }, () => [h(PdfTableCell, () => `Row ${index + 1}`), h(PdfTableCell, () => '1')])),
    ])]])
    expect(lineOf(parsed, 'Carried forward')).toEqual(['', long])
  })

  // A carry row with `pages` is rendered again on each page; its cells keep
  // the measured widths of their columns, so the carried value and the page
  // number sit in the 'auto' column, right of 'Carried p2', and the long value
  // stays on one line. Catches a rendered row without its column styles: its
  // cells share the row and the amount starts left of the column. The
  // column's x (321.15) catches the styles of another column set, given to
  // every cell alike (the amounts at 209.77). Row 42, the last on page 1
  // (the row takes no room there), sets the long value.
  it('keeps the auto column widths in a carry row with pages', async () => {
    const long = '1,234,567.89'
    const { parsed } = await render([() => [h(PdfTable, { columns: [1, 'auto'] }, () => [
      h(PdfTableRow, { fixed: true, pages: 'continuation' }, () => [
        h(PdfTableCell, () => h(PdfText, () => ['Carried p', h(PdfPageNumber)])),
        h(PdfTableCell, () => h(PdfRunningText, { name: 'net', at: 'before' })),
      ]),
      ...Array.from({ length: 60 }, (_, index) => h(PdfTableRow, { key: index, running: { name: 'net', text: index === 41 ? long : '1' } }, () => [h(PdfTableCell, () => `Row ${index + 1}`), h(PdfTableCell, () => '1')])),
    ])]])
    const page = parsed.pages[1]!
    const carried = page.textRuns.find(run => run.text.startsWith('Carried p'))!
    const amount = page.textRuns.find(run => run.text === '1')!
    expect({ carried: carried.text, line: lineOf(parsed, carried.text)[1], amount: round(amount.x), x: round((page.textRuns.find(run => run.text.startsWith('1,'))?.x ?? Number.NaN) - amount.x) })
      .toEqual({ carried: 'Carried p2', line: long, amount: 321.15, x: 0 })
  })

  // The value at the end of a page is known only after the split, so the
  // page is split with the longest value in its place: here two lines in a
  // narrow column. The rows keep their 20 pt and the page ends in its
  // content box. Catches a page split with an empty value: painted with two
  // lines, the carry row would push past the page end or squeeze the rows.
  it('splits the page with the room of the longest value at its end', async () => {
    const values = Array.from({ length: 40 }, (_, index) => `EUR ${index + 1},000.00 net`)
    const { parsed } = await render([() => [h(PdfTable, { columns: [5, 1] }, () => [
      ...values.map((text, index) => h(PdfTableRow, { key: index, style: { height: 20 }, running: { name: 'net', text } }, () => [h(PdfTableCell, () => `Row ${index + 1}`), h(PdfTableCell, () => '1')])),
      h(PdfTableRow, { fixed: true, pages: 'not-last' }, () => [h(PdfTableCell, () => 'Carried over'), h(PdfTableCell, () => h(PdfRunningText, { name: 'net', at: 'end' }))]),
    ])]])
    const rows = parsed.pages[0]!.textRuns.filter(run => /^Row \d+$/.test(run.text)).map(run => run.y)
    expect(new Set(rows.slice(1).map((y, index) => round(rows[index]! - y)))).toEqual(new Set([20]))
    expect(Math.max(...parsed.pages[0]!.textRuns.map(run => PAGE_HEIGHT - run.y))).toBeLessThanOrEqual(PAGE_HEIGHT - 40)
  })
})
