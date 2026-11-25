import { readFileSync } from 'node:fs'
import { PDF_PRIMITIVES } from '../src/runtime/primitives'
import { describe, expect, it } from 'vitest'
import type { PdfFontDataUrl } from '../src/runtime/fonts'
import { createPdfFontStore } from '../src/runtime/server/engine/fonts'
import type { DocumentNode } from '../src/runtime/server/engine/layout/index'
import { collectLayoutWarnings } from '../src/runtime/server/engine/layout-diagnostics'
import { renderDocument } from './engine-render'

// D30: a line is broken at its natural width. A line that is not justified
// keeps its natural advances; justified lines only stretch; a line ends inside
// its box unless it is one token wider than the box.

const FONTS = {
  mono: 'node_modules/source-code-pro/TTF/SourceCodePro-Regular.ttf',
  inter: 'playground/pdfs/fonts/Inter-400.ttf',
  lora: 'playground/pdfs/fonts/Lora-400.ttf',
}
// One font store per render, as the render worker makes it (worker-entry.ts):
// a store's font objects are per render (#83, engine/fonts.ts).
const FONT_DESCRIPTORS = Object.entries(FONTS).map(([family, file]) => ({
  family,
  src: `data:font/ttf;base64,${readFileSync(file).toString('base64')}` as PdfFontDataUrl,
  fontStyle: 'normal' as const,
  fontWeight: 400,
}))

interface LaidLine {
  string: string
  box: { x: number }
  runs: Array<{ positions: Array<{ xAdvance: number }> }>
}
interface LaidNode { lines?: LaidLine[], children?: LaidNode[], box?: { top: number, width: number, height: number }, alignOffset?: number }
const findLines = (node: LaidNode): LaidLine[] =>
  [...(node.lines ?? []), ...(node.children ?? []).flatMap(findLines)]

const round = (value: number) => Math.round(value * 100) / 100

/** Each line as [text without trailing space, x, painted width without trailing space], rounded to 0.01 pt. */
const layoutLines = async (text: string, family: string, width: number, textAlign: string, language: string | null = 'en', hyphens: 'auto' | 'manual' | null = 'auto') => {
  const document = {
    type: PDF_PRIMITIVES.Document,
    props: language === null ? {} : { language },
    children: [{
      type: PDF_PRIMITIVES.Page,
      box: {},
      style: { padding: 0, ...(hyphens === null ? {} : { hyphens }) },
      props: { size: [400, 400] },
      children: [{
        type: PDF_PRIMITIVES.Text,
        box: {},
        style: { fontFamily: family, fontSize: 12, width, textAlign },
        props: {},
        children: [{ type: PDF_PRIMITIVES.TextInstance, value: text }],
      }],
    }],
  } as unknown as DocumentNode
  const { layout } = await renderDocument(document, { fontStore: createPdfFontStore(FONT_DESCRIPTORS) })
  return findLines(layout as unknown as LaidNode).map((line) => {
    const advances = line.runs.flatMap(run => run.positions.map(position => position.xAdvance))
    const trailing = line.string.endsWith(' ') ? advances.at(-1)! : 0
    const painted = advances.reduce((sum, advance) => sum + advance, 0) - trailing
    return [line.string.trimEnd(), round(line.box.x), round(painted)]
  })
}

const TEXT = 'wax fig jar cup oak elm ash yew'
type Row = [family: string, align: string, width: number, lines: Array<[string, number, number]>]

// The box widths are the natural width of "wax fig jar cup" at 12 pt (108,
// 83.40234375 and 80.856 pt), 0.01 pt less and 0.01 pt more.
const rows: Row[] = [
  ['mono', 'left', 108, [['wax fig jar cup', 0, 108], ['oak elm ash yew', 0, 108]]],
  ['mono', 'right', 108, [['wax fig jar cup', 0, 108], ['oak elm ash yew', 0, 108]]],
  ['mono', 'center', 108, [['wax fig jar cup', 0, 108], ['oak elm ash yew', 0, 108]]],
  ['mono', 'justify', 108, [['wax fig jar cup', 0, 108], ['oak elm ash yew', 0, 108]]],
  ['mono', 'left', 107.99, [['wax fig jar', 0, 79.2], ['cup oak elm', 0, 79.2], ['ash yew', 0, 50.4]]],
  ['mono', 'right', 107.99, [['wax fig jar', 28.79, 79.2], ['cup oak elm', 28.79, 79.2], ['ash yew', 57.59, 50.4]]],
  ['mono', 'center', 107.99, [['wax fig jar', 14.39, 79.2], ['cup oak elm', 14.39, 79.2], ['ash yew', 28.79, 50.4]]],
  ['mono', 'justify', 107.99, [['wax fig jar', 0, 107.99], ['cup oak elm', 0, 107.99], ['ash yew', 0, 50.4]]],
  ['mono', 'left', 108.01, [['wax fig jar cup', 0, 108], ['oak elm ash yew', 0, 108]]],
  ['mono', 'right', 108.01, [['wax fig jar cup', 0.01, 108], ['oak elm ash yew', 0.01, 108]]],
  ['mono', 'center', 108.01, [['wax fig jar cup', 0.01, 108], ['oak elm ash yew', 0.01, 108]]],
  ['mono', 'justify', 108.01, [['wax fig jar cup', 0, 108.01], ['oak elm ash yew', 0, 108]]],
  ['inter', 'left', 83.40234375, [['wax fig jar cup', 0, 83.4], ['oak elm ash', 0, 67.97], ['yew', 0, 23.11]]],
  ['inter', 'right', 83.40234375, [['wax fig jar cup', 0, 83.4], ['oak elm ash', 15.43, 67.97], ['yew', 60.29, 23.11]]],
  ['inter', 'center', 83.40234375, [['wax fig jar cup', 0, 83.4], ['oak elm ash', 7.72, 67.97], ['yew', 30.15, 23.11]]],
  ['inter', 'justify', 83.40234375, [['wax fig jar cup', 0, 83.4], ['oak elm ash', 0, 83.4], ['yew', 0, 23.11]]],
  ['inter', 'left', 83.39234375, [['wax fig jar', 0, 58.73], ['cup oak elm', 0, 69.1], ['ash yew', 0, 46.65]]],
  ['inter', 'right', 83.39234375, [['wax fig jar', 24.66, 58.73], ['cup oak elm', 14.29, 69.1], ['ash yew', 36.74, 46.65]]],
  ['inter', 'center', 83.39234375, [['wax fig jar', 12.33, 58.73], ['cup oak elm', 7.15, 69.1], ['ash yew', 18.37, 46.65]]],
  ['inter', 'justify', 83.39234375, [['wax fig jar', 0, 83.39], ['cup oak elm', 0, 83.39], ['ash yew', 0, 46.65]]],
  ['inter', 'left', 83.41234375, [['wax fig jar cup', 0, 83.4], ['oak elm ash', 0, 67.97], ['yew', 0, 23.11]]],
  ['inter', 'right', 83.41234375, [['wax fig jar cup', 0.01, 83.4], ['oak elm ash', 15.44, 67.97], ['yew', 60.3, 23.11]]],
  ['inter', 'center', 83.41234375, [['wax fig jar cup', 0.01, 83.4], ['oak elm ash', 7.72, 67.97], ['yew', 30.15, 23.11]]],
  ['inter', 'justify', 83.41234375, [['wax fig jar cup', 0, 83.41], ['oak elm ash', 0, 83.41], ['yew', 0, 23.11]]],
  ['lora', 'left', 80.856, [['wax fig jar cup', 0, 80.86], ['oak elm ash', 0, 65.4], ['yew', 0, 22.28]]],
  ['lora', 'right', 80.856, [['wax fig jar cup', 0, 80.86], ['oak elm ash', 15.46, 65.4], ['yew', 58.57, 22.28]]],
  ['lora', 'center', 80.856, [['wax fig jar cup', 0, 80.86], ['oak elm ash', 7.73, 65.4], ['yew', 29.29, 22.28]]],
  ['lora', 'justify', 80.856, [['wax fig jar cup', 0, 80.86], ['oak elm ash', 0, 80.86], ['yew', 0, 22.28]]],
  ['lora', 'left', 80.846, [['wax fig jar', 0, 56.99], ['cup oak elm', 0, 67.18], ['ash yew', 0, 44.38]]],
  ['lora', 'right', 80.846, [['wax fig jar', 23.86, 56.99], ['cup oak elm', 13.67, 67.18], ['ash yew', 36.47, 44.38]]],
  ['lora', 'center', 80.846, [['wax fig jar', 11.93, 56.99], ['cup oak elm', 6.84, 67.18], ['ash yew', 18.24, 44.38]]],
  ['lora', 'justify', 80.846, [['wax fig jar', 0, 80.85], ['cup oak elm', 0, 80.85], ['ash yew', 0, 44.38]]],
  ['lora', 'left', 80.866, [['wax fig jar cup', 0, 80.86], ['oak elm ash', 0, 65.4], ['yew', 0, 22.28]]],
  ['lora', 'right', 80.866, [['wax fig jar cup', 0.01, 80.86], ['oak elm ash', 15.47, 65.4], ['yew', 58.58, 22.28]]],
  ['lora', 'center', 80.866, [['wax fig jar cup', 0, 80.86], ['oak elm ash', 7.73, 65.4], ['yew', 29.29, 22.28]]],
  ['lora', 'justify', 80.866, [['wax fig jar cup', 0, 80.87], ['oak elm ash', 0, 80.87], ['yew', 0, 22.28]]],
]

const HYPHENATED = [['in-', 0, 21.6], ['ter-', 0, 28.8], ['na-', 0, 21.6], ['tion-', 0, 36], ['al-', 0, 21.6], ['iza-', 0, 28.8], ['tion', 0, 28.8]]

// The token is 129.6 pt wide in a 60 pt box.
const WIDE: Record<string, Array<[string, number, number]>> = {
  left: [['a', 0, 7.2], ['123456789012345678', 0, 129.6], ['b', 0, 7.2]],
  right: [['a', 52.8, 7.2], ['123456789012345678', 0, 129.6], ['b', 52.8, 7.2]],
  justify: [['a', 0, 7.2], ['123456789012345678', 0, 129.6], ['b', 0, 7.2]],
}

/** The laid-out text node of a 200 pt page that holds one view with these style and children. */
const laidText = async (viewStyle: Record<string, unknown>, children: unknown[]) =>
  (await laidTexts(viewStyle, children))[0]!

/** Every laid-out text node of that page, in tree order; `pageProps` adds to the page's props. */
const laidTexts = async (viewStyle: Record<string, unknown>, children: unknown[], pageProps: Record<string, unknown> = {}) => {
  const document = {
    type: PDF_PRIMITIVES.Document,
    props: {},
    children: [{
      type: PDF_PRIMITIVES.Page,
      box: {},
      style: { padding: 0 },
      props: { size: [200, 400], ...pageProps },
      children: [{ type: PDF_PRIMITIVES.View, box: {}, style: viewStyle, props: {}, children }],
    }],
  } as unknown as DocumentNode
  const { layout } = await renderDocument(document, { fontStore: createPdfFontStore(FONT_DESCRIPTORS) })
  const textsOf = (node: LaidNode): LaidNode[] => node.lines ? [node] : (node.children ?? []).flatMap(textsOf)
  return textsOf(layout as unknown as LaidNode)
}

const monoText = (text: string, style: Record<string, unknown>) =>
  ({ type: PDF_PRIMITIVES.Text, box: {}, style: { fontFamily: 'mono', fontSize: 12, ...style }, props: {}, children: [{ type: PDF_PRIMITIVES.TextInstance, value: text }] })

/**
 * A text and a 92 pt box beside it in a row of 200 pt: the row shrinks the
 * text to 108 pt. The text's box width and its lines, as `layoutLines` gives them.
 */
const shrunkLines = async (text: string, textAlign: string) => {
  const node = await laidText({ flexDirection: 'row' }, [
    monoText(text, { textAlign }),
    { type: PDF_PRIMITIVES.View, box: {}, style: { width: 92, flexShrink: 0 }, props: {}, children: [] },
  ])
  return { width: node.box!.width, alignOffset: node.alignOffset ?? 0, lines: node.lines!.map(line => line.string.trimEnd()) }
}

/**
 * A text with its own style in a 200 pt column that does not stretch it:
 * its box, and each line with the x where it is painted in that box.
 */
const boxedLines = async (text: string, style: Record<string, unknown>) => {
  const node = await laidText({ alignItems: 'flex-start' }, [monoText(text, style)])
  return {
    width: round(node.box!.width),
    height: round(node.box!.height),
    lines: node.lines!.map(line => [line.string.trimEnd(), round(line.box.x - (node.alignOffset ?? 0))]),
  }
}

describe('hyphenation by the document language (D41)', () => {
  const lineStrings = async (text: string, width: number, language: string | null, hyphens: 'auto' | 'manual' | null = 'auto') =>
    (await layoutLines(text, 'mono', width, 'left', language, hyphens)).map(([string]) => string)

  // Catches German hyphenated with English patterns: the language picks them.
  it.each([
    ['de', ['Wahr-', 'schein-', 'lichkeit']],
    ['de-AT', ['Wahr-', 'schein-', 'lichkeit']],
    ['en', ['Wahrschein-', 'lichkeit']],
  ])('breaks a word with the patterns of %s', async (language, lines) => {
    expect(await lineStrings('Wahrscheinlichkeit', 58, language)).toEqual(lines)
  })

  // Catches the language alone switching hyphenation on: it only picks the
  // patterns, `hyphens: 'auto'` (inherited from the page here) uses them,
  // and soft hyphens split a word with either value.
  it.each([
    ['Wahrscheinlichkeit', null, ['Wahrscheinlichkeit']],
    ['Wahrscheinlichkeit', 'manual', ['Wahrscheinlichkeit']],
    ['Wahrscheinlichkeit', 'auto', ['Wahr-', 'schein-', 'lichkeit']],
    ['Wahrschein\u00ADlichkeit', 'manual', ['Wahrschein-', 'lichkeit']],
  ] as const)('breaks %j with hyphens %j in a German document as %j', async (text, hyphens, lines) => {
    expect(await lineStrings(text, 58, 'de', hyphens)).toEqual(lines)
  })

  // Catches automatic hyphenation in a document without a language, and a
  // soft hyphen that stops breaking there.
  it('breaks a word only at its soft hyphens without a language', async () => {
    expect(await lineStrings('internationalization', 41.4, null)).toEqual(['internationalization'])
    expect(await lineStrings('inter\u00ADnationalization', 41.4, null)).toEqual(['inter-', 'nationalization'])
  })

  // Catches a text that the layout makes itself without the patterns: a link
  // around strings becomes a text after the document's texts got theirs.
  it('breaks the text of a link around strings with the patterns of the language', async () => {
    const document = {
      type: PDF_PRIMITIVES.Document,
      props: { language: 'de' },
      children: [{
        type: PDF_PRIMITIVES.Page,
        box: {},
        style: { padding: 0, hyphens: 'auto' },
        props: { size: [400, 400] },
        children: [{
          type: PDF_PRIMITIVES.Link,
          box: {},
          style: { fontFamily: 'mono', fontSize: 12, width: 58 },
          props: { href: 'https://example.com' },
          children: [{ type: PDF_PRIMITIVES.TextInstance, value: 'Wahrscheinlichkeit' }],
        }],
      }],
    } as unknown as DocumentNode
    const { layout } = await renderDocument(document, { fontStore: createPdfFontStore(FONT_DESCRIPTORS) })
    expect(findLines(layout as unknown as LaidNode).map(line => line.string.trimEnd())).toEqual(['Wahr-', 'schein-', 'lichkeit'])
  })

  // Catches a language without patterns that hyphenates silently as English,
  // one whose writing does not hyphenate that warns on every render, and a
  // warning for a document whose texts never ask for the patterns.
  it.each([
    ['tlh', 'auto', [{ code: 'PDF_HYPHENATION_UNAVAILABLE', language: 'tlh' }]],
    ['tlh', 'manual', []],
    ['ja', 'auto', []],
    ['de-AT', 'auto', []],
    [undefined, 'auto', []],
  ])('warns for the language %j with hyphens %j only when it would hyphenate and has no patterns', async (language, hyphens, warnings) => {
    const text = { type: PDF_PRIMITIVES.Text, box: {}, style: {}, props: {}, children: [{ type: PDF_PRIMITIVES.TextInstance, value: 'Wort' }] }
    const page = { type: PDF_PRIMITIVES.Page, box: {}, style: { hyphens }, props: { size: [200, 200] }, children: [text] }
    const document = { type: PDF_PRIMITIVES.Document, props: language === undefined ? {} : { language }, children: [page] } as unknown as DocumentNode
    const { layout } = await renderDocument(document)
    expect(collectLayoutWarnings(layout)).toEqual(warnings)
  })
})

describe('line breaking at natural width (D30)', () => {
  it.each(rows)('%s %s in a %d pt box', async (family, align, width, lines) => {
    expect(await layoutLines(TEXT, family, width, align)).toEqual(lines)
  })

  it('ends a hyphenated line inside its box at the width of its hyphen', async () => {
    // A 12 pt hyphen in Source Code Pro is 7.2 pt wide; the line breaker
    // counted 5 pt, so "inter-" (43.2 pt) went into a 41.4 pt box.
    expect(await layoutLines('internationalization', 'mono', 41.4, 'left')).toEqual(HYPHENATED)
  })

  it('keeps a token wider than its box at its natural width', async () => {
    // No break point (UAX #14 breaks a path after each slash, D44) and
    // no hyphenation point: the token overflows to the right, unsqueezed,
    // also when the text is justified or right-aligned.
    for (const align of ['left', 'right', 'justify']) {
      expect(await layoutLines('a 123456789012345678 b', 'mono', 60, align)).toEqual(WIDE[align])
    }
  })

  // Lines belong to the width of their box. In the row the
  // text is first measured at 200 pt ("wax fig jar cup oak elm" / "ashes
  // yew", a box of 172.8 pt, centred 13.6 pt in), then shrunk to 108 pt; it
  // gets the three lines of 108 pt and no offset. Catches lines kept from
  // the wider measure, which run 57.6 pt past the box into the one beside
  // it, and a centred text moved by the offset of that measure.
  it('lays a text that a row shrinks out again in its narrower box', async () => {
    const lines = ['wax fig jar cup', 'oak elm ashes', 'yew']
    expect(await shrunkLines('wax fig jar cup oak elm ashes yew', 'left')).toEqual({ width: 108, alignOffset: 0, lines })
    expect(await shrunkLines('wax fig jar cup oak elm ashes yew', 'center')).toEqual({ width: 108, alignOffset: 0, lines })
  })

  // Lines belong to the width of their box also when a minimum width makes
  // the box wider than the lines: yoga raises the box after the measure and
  // asks for no other width. Mono 12 pt: 7.2 pt a character, one line
  // 15.08 pt high.
  // - "wax fig" (50.4 pt) centred with minWidth 150: centred in 150, at 49.8.
  //   Catches the offset of the 200 pt measure (74.8): the line painted at 0.
  // - 37 characters (266.4 pt) with minWidth 300 in 200 pt: one line in the
  //   300 pt box, one line high. Catches the two lines of 200 pt in a 300 pt
  //   box, and a box left at the height of two lines.
  it.each([
    ['wax fig', { minWidth: 150, textAlign: 'center' }, { width: 150, height: 15.08, lines: [['wax fig', 49.8]] }],
    ['wax fig jar cup oak elm ashes yew wax', { minWidth: 300 }, { width: 300, height: 15.08, lines: [['wax fig jar cup oak elm ashes yew wax', 0]] }],
  ] as const)('lays %j out in the box its minimum width gives (%j)', async (text, style, expected) => {
    expect(await boxedLines(text, style)).toEqual(expected)
  })

  // A page that does not wrap is laid out once: no relayout of pagination
  // gives the text's box the height of its new lines. Catches the box left
  // at the height of the two lines of 200 pt, which puts "After" a line
  // lower (30.16), for a minimum width in points and in percent.
  it.each([300, '150%'])('gives the box of a minimum width %j the height of its lines on a page that does not wrap', async (minWidth) => {
    const texts = await laidTexts({ alignItems: 'flex-start' }, [monoText('wax fig jar cup oak elm ashes yew wax', { minWidth }), monoText('After', {})], { wrap: false })
    expect(texts.map(text => [round(text.box!.top), round(text.box!.height), text.lines!.length])).toEqual([[0, 15.08, 1], [15.08, 15.08, 1]])
  })
})
