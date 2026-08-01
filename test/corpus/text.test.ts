import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DocumentNode, SafeDocumentNode } from '@react-pdf/layout'
import {
  Font as ReactFont,
  renderToBuffer as renderReactDocument,
} from '@react-pdf/renderer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Component } from 'vue'
import { mountPdfComponent } from '../../src/runtime/renderer'
import { bundlePdfFonts } from '../../src/build/fonts'
import { renderDocument } from '../../src/runtime/server/engine/render-document'
import { createPdfFontStore, type PdfFontStore } from '../../src/runtime/server/engine/fonts'
import {
  VueAlignDoc,
  VueDiacriticsDoc,
  VueHyphenationDoc,
  VueInheritanceDoc,
  VueSpacingDoc,
  VueTruncationDoc,
} from '../fixtures/corpus/text-vue'
import {
  reactAlignDoc,
  reactDiacriticsDoc,
  reactHyphenationDoc,
  reactInheritanceDoc,
  reactSpacingDoc,
  reactTruncationDoc,
} from '../fixtures/corpus/text-react'
import {
  ELLIPSIS,
  alignColumnWidth,
  diacriticsText,
  hyphenationStyles,
  inheritanceStyles,
  truncationMaxLines,
} from '../fixtures/corpus/text-data'
import {
  comparePageImages,
  hasPdfHeader,
  parsePdf,
  rasterizePdf,
  type ParsedPdf,
} from '../utils/pdf'

// ---------------------------------------------------------------------------
// Shared fixture-mounting harness (local to this file per corpus-wave rules).
// ---------------------------------------------------------------------------

const fontPath = fileURLToPath(new URL(
  '../fixtures/assets/Roboto-Regular.ttf',
  import.meta.url,
))
const rasterThresholds = {
  channelThreshold: 25,
  maxChangedPixelRatio: 0.005,
} as const

let fontStore: PdfFontStore
let temporaryRoot: string

beforeAll(async () => {
  ReactFont.register({ family: 'Roboto', src: fontPath })

  temporaryRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-text-'))
  const fontRoot = join(temporaryRoot, 'pdfs/fonts')
  const bundledFontPath = join(fontRoot, 'Roboto-Regular.ttf')
  await mkdir(dirname(bundledFontPath), { recursive: true })
  await copyFile(fontPath, bundledFontPath)

  const fonts = await bundlePdfFonts(
    [{ family: 'Roboto', src: 'Roboto-Regular.ttf' }],
    { fontRoots: [fontRoot] },
  )
  fontStore = createPdfFontStore(fonts)
})

afterAll(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true })
})

const renderReactBytes = async (element: Parameters<typeof renderReactDocument>[0]) =>
  new Uint8Array(await renderReactDocument(element))

const renderVueResult = async (component: Component) => {
  const mounted = await mountPdfComponent(component)
  try {
    return await renderDocument(mounted.document as unknown as DocumentNode, { fontStore })
  }
  finally {
    mounted.unmount()
  }
}

interface RenderedPair {
  react: ParsedPdf
  vue: ParsedPdf
  vueLayout: SafeDocumentNode
  reactBytes: Uint8Array
  vueBytes: Uint8Array
}

/**
 * Render the identical fixture through React PDF and the Vue renderer, then
 * parse both. Every fixture asserts these two PDFs carry identical extracted
 * text and identical line structure (`rawText`), so any behavioural claim
 * proven from the Vue layout transfers to React by construction.
 */
const renderPair = async (
  reactElement: Parameters<typeof renderReactDocument>[0],
  vueComponent: Component,
): Promise<RenderedPair> => {
  const reactBytes = await renderReactBytes(reactElement)
  const vueResult = await renderVueResult(vueComponent)

  expect(hasPdfHeader(reactBytes)).toBe(true)
  expect(hasPdfHeader(vueResult.bytes)).toBe(true)

  const [react, vue] = await Promise.all([
    parsePdf(reactBytes),
    parsePdf(vueResult.bytes),
  ])

  // The renderer-boundary contract: same inputs -> same pages, text and lines.
  expect(vue.pageCount).toBe(react.pageCount)
  expect(vue.pages.map(page => page.text)).toEqual(react.pages.map(page => page.text))
  expect(vue.pages.map(page => page.rawText)).toEqual(react.pages.map(page => page.rawText))

  return {
    react,
    vue,
    vueLayout: vueResult.layout,
    reactBytes,
    vueBytes: vueResult.bytes,
  }
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

const rasterParity = async (a: Uint8Array, b: Uint8Array) => {
  const [pagesA, pagesB] = await Promise.all([rasterizePdf(a), rasterizePdf(b)])
  expect(pagesA).toHaveLength(pagesB.length)
  return pagesA.map((page, index) =>
    comparePageImages(page, pagesB[index]!, rasterThresholds))
}

// ---------------------------------------------------------------------------
// Behavioural conformance fixtures.
// ---------------------------------------------------------------------------

describe('text-behaviour conformance', () => {
  // (1) hyphenationCallback custom splitting + (2) long-word overflow.
  it('hyphenation callback controls where a long token breaks', async () => {
    const { vue, vueLayout } = await renderPair(reactHyphenationDoc(), VueHyphenationDoc)
    const [noHyphenLines, splitLines] = textNodeLines(vueLayout)

    // (2) Disabling hyphenation leaves the token unbroken; it overflows the
    // 132pt column on a single line instead of wrapping.
    expect(noHyphenLines).toHaveLength(1)
    expect(noHyphenLines![0]!.string).toBe('Supercalifragilisticexpialidocious')
    expect(noHyphenLines![0]!.xAdvance).toBeGreaterThan(hyphenationStyles.column.width)

    // (1) The custom six-char splitter introduces break opportunities, so the
    // same token now wraps across several lines, each broken line ending in a
    // hyphen glyph.
    expect(splitLines!.length).toBeGreaterThan(noHyphenLines!.length)
    const broken = splitLines!.slice(0, -1)
    expect(broken.length).toBeGreaterThan(0)
    for (const line of broken) expect(line.string.endsWith('-')).toBe(true)

    // The break structure survives to the actual PDF text on both renderers.
    expect(vue.pages[0]!.rawText).toContain('Supercalifra-\ngilisticexpi-')
  }, 30_000)

  // (3) letterSpacing changes wrapping; wordSpacing is inert in this pipeline.
  it('letterSpacing widens wrapping while wordSpacing stays inert', async () => {
    const { vueLayout } = await renderPair(reactSpacingDoc(), VueSpacingDoc)
    const [tight, wide, wordSpaced] = textNodeLines(vueLayout)

    // letterSpacing enlarges every glyph advance, pushing the text onto more
    // lines than the zero-spacing baseline.
    expect(wide!.length).toBeGreaterThan(tight!.length)

    // wordSpacing is inherited/accepted but never consumed by @react-pdf/layout
    // + textkit (only pdfkit's own text layout reads it, which the render step
    // bypasses). It must therefore produce byte-identical line geometry to the
    // zero-spacing baseline: same line count, strings and advances.
    expect(wordSpaced!.length).toBe(tight!.length)
    expect(wordSpaced!.map(line => line.string)).toEqual(tight!.map(line => line.string))
    wordSpaced!.forEach((line, index) => {
      expect(line.xAdvance).toBeCloseTo(tight![index]!.xAdvance, 6)
    })
  }, 30_000)

  // (4) textAlign left / center / right / justify.
  it('textAlign shifts line origins and justify fills interior lines', async () => {
    const pair = await renderPair(reactAlignDoc(), VueAlignDoc)
    const [left, center, right, justify] = textNodeLines(pair.vueLayout)
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

    // The alignment geometry is a visual claim: React and Vue must rasterise
    // identically (columns are 220pt wide inside an A4 page).
    expect(alignColumnWidth).toBe(220)
    const [parity] = await rasterParity(pair.reactBytes, pair.vueBytes)
    expect(parity).toMatchObject({ dimensionsMatch: true, matches: true, pageNumbersMatch: true })
  }, 30_000)

  // (5) nested style inheritance + inline font switching.
  it('nested Text inherits font/colour while overriding only what it sets', async () => {
    const pair = await renderPair(reactInheritanceDoc(), VueInheritanceDoc)
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

    // Font switching is a visual claim: renderers must rasterise identically.
    const [parity] = await rasterParity(pair.reactBytes, pair.vueBytes)
    expect(parity).toMatchObject({ dimensionsMatch: true, matches: true, pageNumbersMatch: true })
  }, 30_000)

  // (6) German umlauts + Latin-extended diacritics round-tripping.
  it('umlauts and Latin-extended diacritics round-trip through extraction', async () => {
    const { vue } = await renderPair(reactDiacriticsDoc(), VueDiacriticsDoc)

    // Exact round-trip: every code point survives layout and PDF extraction.
    expect(vue.pages[0]!.text).toBe(diacriticsText)
    for (const token of ['Grüße', 'über', 'Öl', 'mäßig', 'schön', 'naïve', 'Señor', 'Dvořák', 'Œuvre']) {
      expect(vue.pages[0]!.text).toContain(token)
    }
  }, 30_000)

  // (7) maxLines + textOverflow ellipsis truncation.
  it('maxLines with ellipsis clamps overflowing text', async () => {
    const { vue, vueLayout } = await renderPair(reactTruncationDoc(), VueTruncationDoc)
    const [clamped] = textNodeLines(vueLayout)

    // Clamped to exactly maxLines, and the last visible line ends with the
    // ellipsis the truncation engine appends.
    expect(clamped).toHaveLength(truncationMaxLines)
    expect(clamped![clamped!.length - 1]!.string.endsWith(ELLIPSIS)).toBe(true)
    expect(vue.pages[0]!.text.endsWith(ELLIPSIS)).toBe(true)
  }, 30_000)
})
