import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { createRenderLimits, DEFAULT_PDF_RENDER_LIMITS } from '../src/runtime/server/render-limits'
import { parsePdf } from '../src/test/pdf'

const { PdfDocument, PdfPage, PdfPageCount, PdfPageNumber, PdfText, PdfView } = PDF_COMPONENTS

// A text with a page token that is longer than a page splits like any text:
// each part keeps its lines, the rest starts where the part before it ended
// and prints the values of its own page. Words are `w1`, `w2`, ...; a token
// prints as `#` and its page number, so every page's runs say which words
// it holds and which numbers it printed.

const PAGE = { size: 'A6', style: { padding: 20, fontSize: 10, lineHeight: 1.2, fontFamily: 'Helvetica' } } as const

/**
 * `count` words from `w1` on, a page token after every `every` words (none
 * when 0). The words between two tokens are one string, so a cut falls inside
 * a static part.
 */
const words = (count: number, every = 0): (string | VNode)[] => {
  const children: (string | VNode)[] = []
  let text = ''
  for (let at = 1; at <= count; at += 1) {
    text += ` w${at}`
    if (every > 0 && at % every === 0) {
      children.push(`${text} #`, h(PdfPageNumber))
      text = ''
    }
  }
  return text === '' ? children : [...children, text]
}

/**
 * The words and tokens of the PDF in order, as `w12` and `#3@3` (the
 * number printed, the page it is on). A render that does not end fails
 * at the deadline, not by memory.
 */
const pagesOf = async (pages: () => VNode[]) => {
  const mounted = await mountPdfComponent(defineComponent(() => () => h(PdfDocument, { creationDate: new Date(0) }, pages)))
  const limits = createRenderLimits({ ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: 3_000 })
  const { bytes } = await renderPlainDocument(mounted.document, { limits })
  return (await parsePdf(bytes)).pages
}

// A right-to-left override (U+202E) shows a number's digits from right to
// left, as the bidi algorithm orders them: page 12 prints 21. The page builder
// paints the reversed range. Catches a number painted forward in it, and the
// document sent away from the builder.
it('paints a page number in a right-to-left override with its digits reversed', async () => {
  const pages = await pagesOf(() => [h(PdfPage, PAGE, () => [
    h(PdfText, { fixed: true }, () => ['Page \u202E', h(PdfPageNumber), '\u202C end']),
    ...Array.from({ length: 12 }, (_, index) => h(PdfText, { break: index > 0 }, () => `Part ${index + 1}`)),
  ])])
  expect(pages.slice(8).map(page => page.textRuns.map(run => run.text).join('').match(/(\d+)\D{0,2}end/)?.[1])).toEqual(['9', '01', '11', '21'])
})

const tokensOf = async (pages: () => VNode[]) => {
  return (await pagesOf(pages)).flatMap(page => page.textRuns.flatMap(run => run.text.split(/\s+/)
    .filter(token => /^(?:w\d+|#\d+)$/.test(token))
    .map(token => token.startsWith('#') ? `${token}@${page.number}` : token)))
}

/** Every word from w1 to w`count` once, in order. */
const expectWords = (tokens: readonly string[], count: number) =>
  expect(tokens.filter(token => token.startsWith('w'))).toEqual(Array.from({ length: count }, (_, index) => `w${index + 1}`))

/** Every token prints the page it is on. */
const expectTokens = (tokens: readonly string[]) => {
  const printed = tokens.filter(token => token.startsWith('#'))
  expect(printed.length).toBeGreaterThan(0)
  for (const token of printed) expect(token).toMatch(/^#(\d+)@\1$/)
}

describe('a dynamic text over several pages', () => {
  // Catches the rest rendered whole again on every page (the render never
  // ends) and a rest that starts at a line instead of at the cut (words lost
  // or printed twice).
  it('prints every word once, and its page number on its last page', async () => {
    const tokens = await tokensOf(() => [h(PdfPage, PAGE, () => [h(PdfText, null, () => [...words(3000), ' #', h(PdfPageNumber)])])])
    expectWords(tokens, 3000)
    expect(tokens.at(-1)).toMatch(/^#(\d+)@\1$/)
    expect(Number(tokens.at(-1)!.split('@')[1])).toBeGreaterThan(10)
  })

  // Eight pages of words first, so the text runs over the seam of pages 9
  // and 10, where a token grows by a digit: the rest is laid out with "10"
  // and must still start at the word after the cut. A token every 7 words.
  // Catches a cut taken as a string offset (a word lost or doubled when the
  // values change length) and a part that prints another page's number.
  it('splits at the seam where a page number grows from 9 to 10', async () => {
    const tokens = await tokensOf(() => [
      ...Array.from({ length: 8 }, () => h(PdfPage, PAGE, () => [h(PdfText, null, () => 'Filler')])),
      h(PdfPage, PAGE, () => [h(PdfText, null, () => words(400, 7))]),
    ])
    expectWords(tokens, 400)
    expectTokens(tokens)
    expect(tokens).toContain('#9@9')
    expect(tokens).toContain('#10@10')
  })

  // The text in a two-column container: column 2 is the rest of the column
  // 1 cut, laid out without rendering again; each page renders its part.
  // Catches a second cut in the same part that starts from the text start.
  it('splits in a two-column container', async () => {
    const tokens = await tokensOf(() => [h(PdfPage, PAGE, () => [h(PdfView, { style: { columnCount: 2, columnGap: 10 } }, () => [h(PdfText, null, () => words(1200, 9))])])])
    expectWords(tokens, 1200)
    expectTokens(tokens)
  })

  // Words that the layout string and the lines tell apart: a soft hyphen in
  // each (not in the lines; a hyphen where a word is split there), a line
  // break every 11 words, and `ß`, which uppercase makes `SS`, so the laid-out
  // string is longer than the parts. A token every 13 words, over 4 pages.
  // Compared without spaces and hyphens, each token as `#T#` once its number
  // is checked against its page. Catches a cut that loses its place after a
  // soft hyphen, or maps the laid-out offset into a part as if the transform
  // kept its length (characters lost or printed twice).
  it('splits a text with soft hyphens, line breaks and an uppercase ß exactly', async () => {
    const source: (string | VNode)[] = []
    let text = ''
    for (let at = 1; at <= 300; at += 1) {
      text += `${at % 11 === 0 ? '\n' : ' '}groß\u00ADstraße${at}`
      if (at % 13 === 0) {
        source.push(`${text} #`, h(PdfPageNumber), '#')
        text = ''
      }
    }
    source.push(text)
    const pages = await pagesOf(() => [h(PdfPage, PAGE, () => [h(PdfText, { style: { textTransform: 'uppercase' } }, () => source)])])
    const printed = pages.map(page => page.textRuns.map(run => run.text).join('').replace(/[\s-]/g, '').replace(/#(\d+)#/g, (_, number) => {
      expect(Number(number)).toBe(page.number)
      return '#T#'
    })).join('')
    const expected = source.map(part => typeof part === 'string' ? part : 'T').join('').toUpperCase().replace(/[\s\u00AD]/g, '')
    expect(pages.length).toBeGreaterThan(3)
    expect(printed).toBe(expected)
  })

  // The total takes reserved digits while the pages are made, as a page
  // number does, and is painted into them after: a part never needs more
  // room than the split gave it. Catches the typed error of today's
  // pagination (which laid the part out again with the total), the end of a
  // part cut off (words lost), and a total that is not the page count.
  it('prints a page count in a text that splits', async () => {
    const pages = await pagesOf(() => [h(PdfPage, PAGE, () => [h(PdfText, null, () => [...words(600), ' #', h(PdfPageCount)])])])
    const tokens = pages.flatMap(page => page.textRuns.flatMap(run => run.text.split(/\s+/).filter(token => /^(?:w\d+|#\d+)$/.test(token))))
    expectWords(tokens, 600)
    expect(pages.length).toBeGreaterThan(1)
    expect(tokens.at(-1)).toBe(`#${pages.length}`)
  })
})

// A fixed text inside a view repeats at the top of each of its parts, as a
// table header does, and a page token in it prints the values of that page;
// in a row cell too. Catches the document sent away from the builder, and the
// rest of a row that leaves out the cell's repeated head (the last page one
// line short: its page check failed).
describe('a fixed text with page tokens inside a view', () => {
  const lines = (count: number) => Array.from({ length: count }, (_, index) => h(PdfText, null, () => `L${index}`))
  const head = () => h(PdfText, { fixed: true }, () => ['H', h(PdfPageNumber), '/', h(PdfPageCount)])
  it.each([
    { label: 'a view', body: () => h(PdfView, null, () => [head(), ...lines(70)]) },
    { label: 'a row cell', body: () => h(PdfView, { style: { flexDirection: 'row' } }, () => [h(PdfView, { style: { width: 80 } }, () => [head(), ...lines(70)]), h(PdfView, { style: { width: 80 } }, () => lines(5))]) },
  ])('repeats in each part of $label with the values of its page', async ({ body }) => {
    const pages = await pagesOf(() => [h(PdfPage, PAGE, () => [body(), h(PdfText, null, () => 'After')])])
    expect(pages.map(page => page.textRuns.find(run => run.text.startsWith('H'))?.text)).toEqual(['H1/3', 'H2/3', 'H3/3'])
  })
})
