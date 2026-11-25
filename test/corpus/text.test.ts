import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SafeDocumentNode } from '../../src/runtime/server/engine/layout/index'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, type Component } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { mountPdfComponent } from '../../src/runtime/renderer'
import { bundlePdfFonts } from '../../src/build/fonts'
import { renderPlainDocument } from '../../src/runtime/server/engine/plain-tree'
import type { BundledPdfFontDescriptor } from '../../src/runtime/fonts'
import { createPdfFontStore } from '../../src/runtime/server/engine/fonts'
import {
  VueAlignDoc,
  VueDiacriticsDoc,
  VueHyphenationDoc,
  VueInheritanceDoc,
  VueSpacingDoc,
  VueUnsupportedWordSpacingDoc,
  VueTruncationDoc,
} from '../fixtures/corpus/text-vue'
import {
  ELLIPSIS,
  alignColumnWidth,
  diacriticsText,
  hyphenationStyles,
  inheritanceStyles,
  truncationMaxLines,
} from '../fixtures/corpus/text-data'
import { hasPdfHeader, parsePdf } from '../../src/test/pdf'

// ---------------------------------------------------------------------------
// Shared fixture-mounting harness (local to this file per corpus-wave rules).
// ---------------------------------------------------------------------------

const fontPath = fileURLToPath(new URL(
  '../fixtures/assets/Roboto-Regular.ttf',
  import.meta.url,
))

let fonts: readonly BundledPdfFontDescriptor[]
let temporaryRoot: string

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-text-'))
  const fontRoot = join(temporaryRoot, 'pdfs/fonts')
  const bundledFontPath = join(fontRoot, 'Roboto-Regular.ttf')
  await mkdir(dirname(bundledFontPath), { recursive: true })
  await copyFile(fontPath, bundledFontPath)

  fonts = await bundlePdfFonts(
    [{ family: 'Roboto', src: 'Roboto-Regular.ttf' }],
    { fontRoots: [fontRoot] },
  )
})

afterAll(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true })
})

const renderVueResult = async (component: Component) => {
  const mounted = await mountPdfComponent(component)
  try {
    // One font store per render, as the render worker makes it
    // (worker-entry.ts): font objects are per render (#83, engine/fonts.ts).
    return await renderPlainDocument(mounted.document, { fontStore: createPdfFontStore(fonts) })
  }
  finally {
    mounted.unmount()
  }
}

/**
 * Renders a fixture and checks its page texts, the literal output of our
 * natural line breaks (D30).
 */
const renderChecked = async (component: Component, pageTexts?: string[]) => {
  const result = await renderVueResult(component)
  expect(hasPdfHeader(result.bytes)).toBe(true)
  const vue = await parsePdf(result.bytes)
  if (pageTexts) expect(vue.pages.map(page => page.text)).toEqual(pageTexts)
  return { vue, vueLayout: result.layout }
}

// ---------------------------------------------------------------------------
// Vue layout-geometry extraction (the behavioural oracle for each claim).
// ---------------------------------------------------------------------------

interface RunInfo {
  font: string
  color?: string
}
interface LineInfo {
  string: string
  x: number
  width: number
  xAdvance: number
  runs: RunInfo[]
}
interface RawLaidLine {
  string: string
  box?: { x: number, width: number }
  xAdvance?: number
  runs?: Array<{
    attributes?: {
      color?: string
      font?: Array<{ fullName?: string, postscriptName?: string, name?: string }>
    }
  }>
}
interface RawLaidNode {
  type?: string
  lines?: RawLaidLine[]
  children?: RawLaidNode[]
}

const fontName = (font?: { fullName?: string, postscriptName?: string, name?: string }): string =>
  font?.postscriptName ?? font?.fullName ?? font?.name ?? 'unknown'

const toLineInfo = (line: RawLaidLine): LineInfo => ({
  string: line.string,
  x: line.box?.x ?? 0,
  width: line.box?.width ?? 0,
  xAdvance: line.xAdvance ?? 0,
  runs: (line.runs ?? []).map(run => ({
    font: fontName(run.attributes?.font?.[0]),
    color: run.attributes?.color,
  })),
})

/** Ordered list of laid-out TEXT nodes, each reduced to its line geometry. */
const textNodeLines = (layout: SafeDocumentNode): LineInfo[][] => {
  const result: LineInfo[][] = []
  const walk = (node: RawLaidNode) => {
    if (node.type === 'TEXT' && Array.isArray(node.lines)) {
      result.push(node.lines.map(toLineInfo))
    }
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(layout as unknown as RawLaidNode)
  return result
}

// ---------------------------------------------------------------------------
// Behavioural conformance fixtures.
// ---------------------------------------------------------------------------

describe('text-behaviour conformance', () => {
  // (1) hyphenation with `hyphens: 'auto'` (inherited from the page) + (2) long-word overflow with `hyphens: 'manual'`.
  it('hyphens: \'manual\' keeps a long token whole; hyphens: \'auto\' breaks it', async () => {
    const { vue, vueLayout } = await renderChecked(VueHyphenationDoc, [
      'Supercalifragilisticexpialidocious Supercalifrag- ilisticexpiali- docious',
    ])
    const [noHyphenLines, splitLines] = textNodeLines(vueLayout)

    // (2) Without automatic hyphenation the token stays unbroken; it overflows the
    // 132pt column on a single line instead of wrapping.
    expect(noHyphenLines).toHaveLength(1)
    expect(noHyphenLines![0]!.string).toBe('Supercalifragilisticexpialidocious')
    expect(noHyphenLines![0]!.xAdvance).toBeGreaterThan(hyphenationStyles.column.width)

    // (1) Automatic hyphenation introduces break opportunities, so the
    // same token now wraps across several lines, each broken line ending in a
    // hyphen glyph.
    expect(splitLines!.length).toBeGreaterThan(noHyphenLines!.length)
    const broken = splitLines!.slice(0, -1)
    expect(broken.length).toBeGreaterThan(0)
    for (const line of broken) expect(line.string.endsWith('-')).toBe(true)

    // The break structure survives to the actual PDF text.
    expect(vue.pages[0]!.rawText).toContain('Supercalifrag-\nilisticexpiali-')
  }, 30_000)

  // (3) letterSpacing changes wrapping; inert wordSpacing is not public API.
  it('letterSpacing widens wrapping and unsupported wordSpacing fails closed', async () => {
    const { vueLayout } = await renderChecked(VueSpacingDoc, [
      // Ragged lines stretch at their ends (D42), so no word needs a hyphen.
      'alpha beta gamma delta epsilon zeta a l p h a b e t a g a m m a d e l t a e p s i l o n z e t a',
    ])
    const [tight, wide] = textNodeLines(vueLayout)

    // letterSpacing enlarges every glyph advance, pushing the text onto more
    // lines than the zero-spacing baseline.
    expect(wide!.length).toBeGreaterThan(tight!.length)

    await expect(renderVueResult(VueUnsupportedWordSpacingDoc)).rejects.toThrow(
      'Unsupported PDF style "wordSpacing"',
    )
  }, 30_000)

  // (4) textAlign left / center / right / justify.
  it('textAlign shifts line origins and justify fills interior lines', async () => {
    const column = 'Nuxt PDF turns structured application data into a laid out document tree that wraps across several measured lines inside this narrow column.'
    const pair = await renderChecked(VueAlignDoc, [Array.from({ length: 4 }, () => column).join(' ')])
    const [left, center, right, justify] = textNodeLines(pair.vueLayout)
    for (const lines of [left, center, right, justify]) {
      expect(lines!.map(line => line.string.trimEnd())).toEqual([
        'Nuxt PDF turns structured application data',
        'into a laid out document tree that wraps',
        'across several measured lines inside this',
        'narrow column.',
      ])
    }
    const tol = 0.5

    // left: every line origin sits flush at the column start.
    for (const line of left!) expect(line.x).toBeCloseTo(0, 3)

    // right: the first line is pushed fully right by (width - advance),
    // whereas the same left line stayed at x = 0.
    const rightShift = right![0]!.width - right![0]!.xAdvance
    expect(rightShift).toBeGreaterThan(tol)
    expect(right![0]!.x).toBeCloseTo(rightShift, 1)
    expect(left![0]!.x).toBeCloseTo(0, 3)

    // center: the first line is shifted by exactly half the right shift.
    expect(center![0]!.x).toBeCloseTo(rightShift / 2, 1)

    // justify: interior (non-last) lines are stretched to fill the line box,
    // while the last line keeps its natural, shorter advance. The same interior
    // lines under left alignment are demonstrably NOT filled.
    const justifyInterior = justify!.slice(0, -1)
    const justifyLast = justify![justify!.length - 1]!
    for (const line of justifyInterior) {
      expect(line.xAdvance / line.width).toBeGreaterThan(0.99)
    }
    expect(justifyLast.xAdvance / justifyLast.width).toBeLessThan(0.9)
    expect(left![0]!.xAdvance / left![0]!.width).toBeLessThan(0.99)

    // Every line keeps its natural advance and ends inside the 220 pt column.
    expect(alignColumnWidth).toBe(220)
    for (const line of [...left!, ...center!, ...right!]) {
      expect(line.x + line.xAdvance).toBeLessThanOrEqual(line.width + tol)
    }
  }, 30_000)

  // (5) nested style inheritance + inline font switching.
  it('nested Text inherits font/colour while overriding only what it sets', async () => {
    const pair = await renderChecked(VueInheritanceDoc)
    const [robotoWord, helveticaWord, nested] = textNodeLines(pair.vueLayout)

    // The fontFamily switch genuinely changes the resolved font: identical text,
    // different embedded font on each line.
    expect(robotoWord![0]!.runs[0]!.font).toBe('Roboto-Regular')
    expect(helveticaWord![0]!.runs[0]!.font).toBe('Helvetica')

    // The nested run inherits Helvetica from its parent (overriding the page's
    // default Roboto) and overrides only its own colour; its siblings keep the
    // parent's inherited colour.
    const firstLineRuns = nested![0]!.runs
    for (const run of firstLineRuns) expect(run.font).toBe('Helvetica')
    const overridden = firstLineRuns.find(run => run.color === inheritanceStyles.nestedOverride.color)
    expect(overridden).toBeDefined()
    expect(overridden!.font).toBe('Helvetica')
    const inheritedColour = inheritanceStyles.outer.color
    expect(firstLineRuns.filter(run => run.color === inheritedColour).length).toBeGreaterThanOrEqual(2)

    // Mixed inline content concatenates back to the original string.
    expect(pair.vue.pages[0]!.text).toBe('Weight Weight Base child tail')
    expect(pair.vue.pages[0]!.rawText).toBe('Weight\nWeight\nBase child\ntail')
  }, 30_000)

  // (6) German umlauts + Latin-extended diacritics round-tripping.
  it('umlauts and Latin-extended diacritics round-trip through extraction', async () => {
    const { vue } = await renderChecked(VueDiacriticsDoc)

    // Exact round-trip: every code point survives layout and PDF extraction.
    expect(vue.pages[0]!.text).toBe(diacriticsText)
    for (const token of ['Grüße', 'über', 'Öl', 'mäßig', 'schön', 'naïve', 'Señor', 'Dvořák', 'Œuvre']) {
      expect(vue.pages[0]!.text).toContain(token)
    }
  }, 30_000)

  // (7) maxLines + textOverflow ellipsis truncation.
  it('maxLines with ellipsis clamps overflowing text', async () => {
    const { vue, vueLayout } = await renderChecked(VueTruncationDoc, [
      'This paragraph is deliberately long enough to wrap onto many lines so that…',
    ])
    const [clamped] = textNodeLines(vueLayout)

    // Clamped to exactly maxLines, and the last visible line ends with the
    // ellipsis the truncation engine appends.
    expect(clamped).toHaveLength(truncationMaxLines)
    expect(clamped![clamped!.length - 1]!.string.endsWith(ELLIPSIS)).toBe(true)
    expect(vue.pages[0]!.text.endsWith(ELLIPSIS)).toBe(true)
  }, 30_000)

  it('verticalAlign lowers and raises a nested text and its link', async () => {
    const { PdfDocument, PdfLink, PdfPage, PdfText } = PDF_COMPONENTS
    const small = { fontSize: 9 }
    const { vue } = await renderChecked(defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { size: [300, 100], style: { padding: 20, fontFamily: 'Roboto' } }, () => [
      h(PdfText, { style: { fontSize: 15 } }, () => ['CO', h(PdfText, { style: { ...small, verticalAlign: 'sub' } }, () => '2'), ' in m', h(PdfText, { style: { ...small, verticalAlign: 'super' } }, () => '3'), h(PdfLink, { href: 'https://example.com/note', style: { ...small, verticalAlign: 'super' } }, () => '1')]),
    ]))))
    const page = vue.pages[0]!
    expect(page.text).toBe('CO2 in m31')
    const baseline = (text: string) => page.textRuns.find(run => run.text === text)!.y
    // A fifth of the parent's 15 pt down, a third up; y points up in PDF space.
    expect([baseline('CO'), baseline('2'), baseline('in m'), baseline('31')]).toEqual([66.084, 63.084, 66.084, 71.084])
    // The link's area moves with its run: it starts at the raised baseline less Roboto's 9 pt descent (2.197).
    expect(page.annotations.map(link => [link.url, link.rect?.[1]])).toEqual([['https://example.com/note', 68.887]])
  }, 30_000)

  it('verticalAlign: an underline sits at the baseline of the text that sets it, shifts add up', async () => {
    const { PdfDocument, PdfLink, PdfPage, PdfText } = PDF_COMPONENTS
    const { vue, vueLayout } = await renderChecked(defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { size: [300, 140], style: { padding: 20, fontFamily: 'Roboto' } }, () => [
      h(PdfText, { style: { fontSize: 15, textDecoration: 'underline' } }, () => ['x', h(PdfText, { style: { fontSize: 9, verticalAlign: 'super' } }, () => '2')]),
      h(PdfText, { style: { fontSize: 15 } }, () => ['Note', h(PdfLink, { href: 'https://example.com/note', style: { fontSize: 9, verticalAlign: 'super', textDecoration: 'underline' } }, () => '1')]),
      // `baseline` resets the key, so an outer text accepts it.
      h(PdfText, { style: [{ fontSize: 15 }, { verticalAlign: 'baseline' }] }, () => ['a', h(PdfText, { style: { fontSize: 9, verticalAlign: 'super' } }, () => ['b', h(PdfText, { style: { fontSize: 6, verticalAlign: 'super' } }, () => 'c')])]),
    ]))))
    const page = vue.pages[0]!
    const decorations: number[][] = []
    const walk = (node: { type?: string, lines?: Array<{ box?: { y: number }, decorationLines?: Array<{ rect: { y: number } }> }>, children?: unknown[] }) => {
      if (node.type === 'TEXT' && node.lines) decorations.push(node.lines.flatMap(line => (line.decorationLines ?? []).map(decoration => Number(decoration.rect.y.toFixed(3)))))
      for (const child of node.children ?? []) walk(child as typeof node)
    }
    walk(vueLayout as unknown as Parameters<typeof walk>[0])
    // y from each line's top; Roboto's 15 pt ascent is 13.916. 'x²': one line
    // two thicknesses (1 pt each, from the 15 pt text) under the baseline. The
    // mark: at its raised baseline (13.916 - 5) and in its own 0.5 pt.
    expect(decorations).toEqual([[15.916, 15.916], [9.916], []])
    const baseline = (text: string) => page.textRuns.find(run => run.text === text)!.y
    // A third of 15 pt, then a third of 9 pt on top of it.
    expect([baseline('a'), baseline('b'), baseline('c')]).toEqual([70.928, 75.928, 78.928])
  }, 30_000)
})
