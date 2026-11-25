import type { DocumentNode } from '../../src/runtime/server/engine/layout/index'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Component } from 'vue'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { mountPdfComponent } from '../../src/runtime/renderer'
import { renderDocument } from '../engine-render'
import {
  documentMeta,
  linkHitSlop,
  linkTargets,
  noteContent,
  pageSetupCases,
} from '../fixtures/corpus/annotations-data'
import {
  VueAnnotationsDocument,
  VueMetadataDocument,
  VuePageSetupDocument,
} from '../fixtures/corpus/annotations-vue'
import { hasPdfHeader, installPdfCanvasGlobals, parsePdf } from '../../src/test/pdf'

const { PdfDocument, PdfPage, PdfText } = PDF_COMPONENTS

// --- local render helper ---

const renderVue = async (component: Component): Promise<Uint8Array> => {
  const mounted = await mountPdfComponent(component)
  try {
    const result = await renderDocument(
      mounted.document as unknown as DocumentNode,
    )
    return result.bytes
  }
  finally {
    mounted.unmount()
  }
}

// --- local pdfjs inspection (src/test/pdf.ts exposes text/links but not info,
//     MediaBox, page layout, or note contents, so read them here directly) ---

let pdfJsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined

const withPdf = async <Result>(
  bytes: Uint8Array,
  read: (document: PDFDocumentProxy) => Promise<Result>,
): Promise<Result> => {
  installPdfCanvasGlobals()
  pdfJsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdfJs = await pdfJsPromise
  const task = pdfJs.getDocument({
    data: Uint8Array.from(bytes),
    stopAtErrors: true,
    useWorkerFetch: false,
    verbosity: 0,
  })
  try {
    return await read(await task.promise)
  }
  finally {
    await task.destroy()
  }
}

/** The subset of info-dictionary / catalog fields this fixture pins. */
const INFO_KEYS = [
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'Creator',
  'Producer',
  'CreationDate',
  'PDFFormatVersion',
  'Language',
] as const

type InfoSubset = Record<(typeof INFO_KEYS)[number], unknown>

const readInfoSubset = (bytes: Uint8Array): Promise<InfoSubset> =>
  withPdf(bytes, async (document) => {
    const { info } = await document.getMetadata()
    const record = info as Record<string, unknown>
    return Object.fromEntries(
      INFO_KEYS.map(key => [key, record[key]]),
    ) as InfoSubset
  })

const readPageLayout = (bytes: Uint8Array): Promise<string> =>
  withPdf(bytes, document => document.getPageLayout())

/** MediaBox `[width, height]` per page, rounded to 2dp to absorb float noise. */
// The size a reader shows: the MediaBox times the page's UserUnit.
const readMediaBoxes = (bytes: Uint8Array): Promise<Array<[number, number]>> =>
  withPdf(bytes, async (document) => {
    const boxes: Array<[number, number]> = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      try {
        const [x0, y0, x1, y1] = page.view
        boxes.push([round2((x1! - x0!) * page.userUnit), round2((y1! - y0!) * page.userUnit)])
      }
      finally {
        page.cleanup()
      }
    }
    return boxes
  })

/** Contents of every Text (sticky note) annotation on page 1. */
const readNoteContents = (bytes: Uint8Array): Promise<string[]> =>
  withPdf(bytes, async (document) => {
    const page = await document.getPage(1)
    try {
      const annotations = await page.getAnnotations({ intent: 'display' })
      return annotations
        .filter((annotation): annotation is { subtype: string, contentsObj?: { str?: string } } =>
          isRecord(annotation) && annotation.subtype === 'Text')
        .map(annotation => annotation.contentsObj?.str ?? '')
    }
    finally {
      page.cleanup()
    }
  })

const round2 = (value: number): number => Math.round(value * 100) / 100

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

describe('corpus: annotations, metadata, and page setup', () => {
  it('renders external http/mailto Link annotations at their places', async () => {
    const vueBytes = await renderVue(VueAnnotationsDocument)
    expect(hasPdfHeader(vueBytes)).toBe(true)

    const vueLinks = (await parsePdf(vueBytes)).pages
      .flatMap(page => page.annotations)
      .filter(annotation => annotation.subtype === 'Link')
    // The rectangles, the hit slop of the first one included.
    expect(vueLinks).toEqual([
      { annotationType: 2, rect: [-11, 814.89, 125, 844.89], subtype: 'Link', unsafeUrl: 'https://example.com/docs?tab=annotations', url: 'https://example.com/docs?tab=annotations' },
      { annotationType: 2, rect: [0, 801.89, 120, 821.89], subtype: 'Link', unsafeUrl: 'mailto:reports@example.com', url: 'mailto:reports@example.com' },
    ])

    // Both external targets round-trip as their exact URI.
    expect(vueLinks).toContainEqual(expect.objectContaining({
      subtype: 'Link',
      url: linkTargets.external,
      unsafeUrl: linkTargets.external,
    }))
    expect(vueLinks).toContainEqual(expect.objectContaining({
      subtype: 'Link',
      url: linkTargets.mailto,
      unsafeUrl: linkTargets.mailto,
    }))

    const hitSlopLink = vueLinks.find(link => link.unsafeUrl === linkTargets.external)
    const plainLink = vueLinks.find(link => link.unsafeUrl === linkTargets.mailto)
    expect(hitSlopLink?.rect).toHaveLength(4)
    expect(plainLink?.rect).toHaveLength(4)

    const rectSize = (rect: number[]) => ({
      width: rect[2]! - rect[0]!,
      height: rect[3]! - rect[1]!,
    })
    const hitSlopSize = rectSize(hitSlopLink!.rect!)
    const plainSize = rectSize(plainLink!.rect!)

    expect(hitSlopSize.width - plainSize.width).toBeCloseTo(
      linkHitSlop.left + linkHitSlop.right,
      3,
    )
    expect(hitSlopSize.height - plainSize.height).toBeCloseTo(
      linkHitSlop.top + linkHitSlop.bottom,
      3,
    )
  })

  it('renders PdfNote content as a Text annotation', async () => {
    const vueNotes = await readNoteContents(await renderVue(VueAnnotationsDocument))
    expect(vueNotes).toEqual([noteContent])
  })

  it('round-trips document metadata through the info dictionary', async () => {
    const vueInfo = await readInfoSubset(await renderVue(VueMetadataDocument))

    // Title, author, subject, keywords, language, creation date and pdfVersion
    // all survive the round trip.
    expect(vueInfo).toMatchObject({
      Title: documentMeta.title,
      Author: documentMeta.author,
      Subject: documentMeta.subject,
      Keywords: documentMeta.keywords,
      Creator: documentMeta.creator,
      Producer: documentMeta.producer,
      Language: documentMeta.language,
      PDFFormatVersion: documentMeta.pdfVersion,
    })
    // The Date becomes a PDF date string of the pinned instant.
    expect(vueInfo.CreationDate).toBe('D:20260720000000Z')
  })

  it('flows pdfVersion and pageLayout into the catalog', async () => {
    // pdfVersion is visible in the header; pdfjs also surfaces it as
    // PDFFormatVersion (asserted above). pageLayout lands in the catalog and
    // pdfjs exposes it PascalCased.
    const vueLayout = await readPageLayout(await renderVue(VueMetadataDocument))
    expect(vueLayout).toBe('TwoColumnLeft')
  })

  it('resolves page sizes, orientation, and dpi to their MediaBox', async () => {
    const vueBoxes = await readMediaBoxes(await renderVue(VuePageSetupDocument))
    expect(vueBoxes).toHaveLength(pageSetupCases.length)

    // Each MediaBox matches the hand-computed dimensions.
    const expected = pageSetupCases.map(pageCase => pageCase.expected)
    expect(vueBoxes).toEqual(expected)
  })

  // Catches dpi scaling more than `px`: a point stays a point at any dpi, and
  // only a px length is read at the page's dpi.
  it('reads only px lengths at the page dpi', async () => {
    const page = (dpi: number) => h(PdfPage, { size: 'A4', dpi }, () => [
      h(PdfText, { style: { marginLeft: 100 } }, () => 'points'),
      h(PdfText, { style: { marginLeft: '100px' } }, () => 'pixels'),
    ])
    const parsed = await parsePdf(await renderVue(defineComponent(() => () =>
      h(PdfDocument, { creationDate: documentMeta.creationDate }, () => [page(72), page(144)]))))
    const left = (pageIndex: number, text: string) => parsed.pages[pageIndex]!.textRuns.find(run => run.text === text)!.x
    expect([left(0, 'points'), left(1, 'points'), left(0, 'pixels'), left(1, 'pixels')]).toEqual([100, 100, 100, 50])
  })
})
