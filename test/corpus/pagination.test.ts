import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Component } from 'vue'
import type { DocumentNode } from '@react-pdf/layout'
import {
  Font as ReactFont,
  renderToBuffer as renderReactDocument,
} from '@react-pdf/renderer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mountPdfComponent, type PdfComponentProps } from '../../src/runtime/renderer'
import { bundlePdfFonts } from '../../src/build/fonts'
import { renderDocument } from '../../src/runtime/server/engine/render-document'
import { createPdfFontStore, type PdfFontStore } from '../../src/runtime/server/engine/fonts'
import {
  comparePageImages,
  decodePngPage,
  hasPdfHeader,
  parsePdf,
  rasterizePdf,
  type ParsedPdf,
} from '../utils/pdf'
import {
  createReactWrapFalseDocument,
  VueWrapFalseDocument,
  wrapFalseEnd,
  wrapFalseStart,
} from '../fixtures/corpus/pagination-wrap-false'
import {
  createReactExplicitBreakDocument,
  explicitBreakBlocks,
  VueExplicitBreakDocument,
} from '../fixtures/corpus/pagination-explicit-break'
import {
  createReactMinPresenceDocument,
  minPresenceBody,
  minPresenceHeading,
  VueMinPresenceDocument,
} from '../fixtures/corpus/pagination-min-presence'
import {
  createReactWidowsOrphansDocument,
  VueWidowsOrphansDocument,
  widowsOrphansEnd,
  widowsOrphansStart,
} from '../fixtures/corpus/pagination-widows-orphans'
import {
  createReactFixedMultipageDocument,
  fixedBody,
  fixedFooter,
  fixedHeader,
  VueFixedMultipageDocument,
} from '../fixtures/corpus/pagination-fixed-multipage'
import {
  dynamicPageMarker,
  VueDynamicPageNumberDocument,
} from '../fixtures/corpus/pagination-dynamic-page-number'

const fontPath = fileURLToPath(new URL(
  '../fixtures/assets/Roboto-Regular.ttf',
  import.meta.url,
))
const baselineDirectory = fileURLToPath(new URL(
  '../fixtures/baselines/corpus',
  import.meta.url,
))
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'
const rasterThresholds = {
  channelThreshold: 25,
  maxChangedPixelRatio: 0.005,
} as const

let fontStore: PdfFontStore
let temporaryRoot: string

beforeAll(async () => {
  ReactFont.register({ family: 'Roboto', src: fontPath })

  temporaryRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-pagination-'))
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

interface Rendered {
  bytes: Uint8Array
  pdf: ParsedPdf
  texts: string[]
}

async function renderReact(document: ReturnType<typeof createReactWrapFalseDocument>): Promise<Rendered> {
  const bytes = new Uint8Array(await renderReactDocument(document))
  const pdf = await parsePdf(bytes)
  return { bytes, pdf, texts: pdf.pages.map(page => page.text) }
}

async function renderVue(component: Component, props: PdfComponentProps = {}): Promise<Rendered> {
  const mounted = await mountPdfComponent(component, props)
  try {
    const result = await renderDocument(
      mounted.document as unknown as DocumentNode,
      { fontStore },
    )
    const pdf = await parsePdf(result.bytes)
    return { bytes: result.bytes, pdf, texts: pdf.pages.map(page => page.text) }
  }
  finally {
    mounted.unmount()
  }
}

/** 1-based page number of the first page whose text contains `marker`, else 0. */
function pageOf(texts: string[], marker: string): number {
  const index = texts.findIndex(text => text.includes(marker))
  return index === -1 ? 0 : index + 1
}

describe('pagination conformance', () => {
  it('wrap=false grows one tall page to hold all overflow; wrap=true paginates', async () => {
    const reactUnwrapped = await renderReact(createReactWrapFalseDocument({ wrap: false }))
    const vueUnwrapped = await renderVue(VueWrapFalseDocument, { wrap: false })

    expect(hasPdfHeader(reactUnwrapped.bytes)).toBe(true)
    expect(hasPdfHeader(vueUnwrapped.bytes)).toBe(true)

    // wrap=false must NOT paginate even though the rows exceed one A4 page height.
    expect(reactUnwrapped.pdf.pageCount).toBe(1)
    expect(vueUnwrapped.pdf.pageCount).toBe(1)
    expect(vueUnwrapped.texts).toEqual(reactUnwrapped.texts)
    // Nothing is dropped: the first (only) page holds both the first and last row.
    expect(vueUnwrapped.texts[0]).toContain(wrapFalseStart)
    expect(vueUnwrapped.texts[0]).toContain(wrapFalseEnd)

    // Identical content with wrap=true is the control: it paginates.
    const reactWrapped = await renderReact(createReactWrapFalseDocument({ wrap: true }))
    const vueWrapped = await renderVue(VueWrapFalseDocument, { wrap: true })
    expect(reactWrapped.pdf.pageCount).toBe(2)
    expect(vueWrapped.pdf.pageCount).toBe(2)
    expect(vueWrapped.texts).toEqual(reactWrapped.texts)
    expect(pageOf(vueWrapped.texts, wrapFalseEnd)).toBe(2)

    // The distinctive artifact is geometric: the single wrap=false page is TALLER
    // than a standard A4 page (it grew to fit), and Vue reproduces React exactly.
    // A4 portrait height is ~842pt; rasterizePdf at scale 1 yields point-sized px.
    const [reactPages, vuePages] = await Promise.all([
      rasterizePdf(reactUnwrapped.bytes),
      rasterizePdf(vueUnwrapped.bytes),
    ])
    expect(vuePages).toHaveLength(1)
    const vuePage = vuePages[0]!
    const reactPage = reactPages[0]!
    const a4PortraitHeight = 842
    expect(vuePage.height).toBeGreaterThan(a4PortraitHeight)
    expect(vuePage.height).toBe(reactPage.height)
    expect(vuePage.width).toBe(reactPage.width)
    expect(comparePageImages(vuePage, reactPage, rasterThresholds)).toMatchObject({
      dimensionsMatch: true,
      matches: true,
      pageNumbersMatch: true,
    })

    const baselinePath = join(baselineDirectory, 'pagination-wrap-false-page-1.png')
    if (updatePdfBaselines) {
      await mkdir(baselineDirectory, { recursive: true })
      await writeFile(baselinePath, vuePage.png)
    }
    const baseline = await decodePngPage(await readFile(baselinePath), vuePage.number)
    expect(comparePageImages(vuePage, baseline, rasterThresholds)).toMatchObject({
      dimensionsMatch: true,
      matches: true,
      pageNumbersMatch: true,
    })
  }, 30_000)

  it('explicit break on nested wrapped Views lands each block on its own page', async () => {
    const react = await renderReact(createReactExplicitBreakDocument())
    const vue = await renderVue(VueExplicitBreakDocument)

    expect(react.pdf.pageCount).toBe(3)
    expect(vue.pdf.pageCount).toBe(3)
    expect(vue.texts).toEqual(react.texts)

    explicitBreakBlocks.forEach((block, index) => {
      const expectedPage = index + 1
      expect(pageOf(vue.texts, block.marker)).toBe(expectedPage)
      // Nothing from another block leaks onto this page.
      for (const other of explicitBreakBlocks) {
        if (other === block) continue
        expect(vue.texts[expectedPage - 1]).not.toContain(other.marker)
      }
    })
  }, 20_000)

  it('minPresenceAhead pushes a bottom-of-page heading onto the next page with its block', async () => {
    // Control: no minPresenceAhead — the heading fits at the bottom of page one
    // and its body is stranded onto page two.
    const reactControl = await renderReact(createReactMinPresenceDocument())
    const vueControl = await renderVue(VueMinPresenceDocument)
    expect(reactControl.pdf.pageCount).toBe(2)
    expect(vueControl.pdf.pageCount).toBe(2)
    expect(vueControl.texts).toEqual(reactControl.texts)
    expect(pageOf(reactControl.texts, minPresenceHeading)).toBe(1)
    expect(pageOf(reactControl.texts, minPresenceBody)).toBe(2)
    expect(pageOf(vueControl.texts, minPresenceHeading)).toBe(1)
    expect(pageOf(vueControl.texts, minPresenceBody)).toBe(2)

    // Treatment: minPresenceAhead demands more space than remains, so the heading
    // itself breaks to page two and rejoins its following block.
    const reactKept = await renderReact(createReactMinPresenceDocument({ minPresenceAhead: 120 }))
    const vueKept = await renderVue(VueMinPresenceDocument, { minPresenceAhead: 120 })
    expect(reactKept.pdf.pageCount).toBe(2)
    expect(vueKept.pdf.pageCount).toBe(2)
    expect(vueKept.texts).toEqual(reactKept.texts)
    expect(pageOf(reactKept.texts, minPresenceHeading)).toBe(2)
    expect(pageOf(vueKept.texts, minPresenceHeading)).toBe(2)
    expect(pageOf(vueKept.texts, minPresenceBody)).toBe(2)
  }, 30_000)

  it('widows/orphans split a wrapped paragraph at the same boundary as React', async () => {
    const react = await renderReact(createReactWidowsOrphansDocument())
    const vue = await renderVue(VueWidowsOrphansDocument)

    expect(react.pdf.pageCount).toBe(2)
    expect(vue.pdf.pageCount).toBe(2)
    expect(vue.texts).toEqual(react.texts)

    // The paragraph starts on page one and finishes on page two.
    expect(pageOf(vue.texts, widowsOrphansStart)).toBe(1)
    expect(pageOf(vue.texts, widowsOrphansEnd)).toBe(2)
    // Pin the exact wrap boundary React produced: page one ends at word47,
    // page two resumes at word48.
    expect(vue.texts[0]).toContain('word47')
    expect(vue.texts[0]).not.toContain('word48')
    expect(vue.texts[1]).toContain('word48')
    expect(react.texts[0]).toContain('word47')
    expect(react.texts[0]).not.toContain('word48')
  }, 20_000)

  it('fixed header and footer repeat on every page of a wrapped multi-page flow', async () => {
    const react = await renderReact(createReactFixedMultipageDocument())
    const vue = await renderVue(VueFixedMultipageDocument)

    expect(react.pdf.pageCount).toBeGreaterThanOrEqual(4)
    expect(vue.pdf.pageCount).toBe(react.pdf.pageCount)
    expect(vue.texts).toEqual(react.texts)

    // The fixed header and footer appear on EVERY page.
    for (const pageText of vue.texts) {
      expect(pageText).toContain(fixedHeader)
      expect(pageText).toContain(fixedFooter)
    }
    // The flowing body advances across pages: first body line on page one, last
    // on the final page.
    expect(pageOf(vue.texts, fixedBody[0]!)).toBe(1)
    expect(pageOf(vue.texts, fixedBody[fixedBody.length - 1]!)).toBe(vue.pdf.pageCount)
  }, 30_000)

  it('dynamic page-number text is correct on every wrapped page (computed oracle)', async () => {
    // React PDF diverges on dynamic text (compounding lineHeight); nuxt-pdf
    // shields it, so this is proven against a computed oracle, not React output.
    const vue = await renderVue(VueDynamicPageNumberDocument)
    const totalPages = vue.pdf.pageCount
    expect(totalPages).toBeGreaterThanOrEqual(4)

    vue.texts.forEach((pageText, index) => {
      expect(pageText).toContain(dynamicPageMarker(index + 1, totalPages))
    })
    // A wrong page number must NOT appear (guards against a stale/duplicated
    // footer painting the same number on every page).
    expect(vue.texts[1]).not.toContain(dynamicPageMarker(1, totalPages))
  }, 30_000)
})
