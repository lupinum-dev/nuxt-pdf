import type { DocumentNode } from '@react-pdf/layout'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderToBuffer as renderReactDocument } from '@react-pdf/renderer'
import type { Component } from 'vue'
import { describe, expect, it } from 'vitest'
import { mountPdfComponent } from '../../src/runtime/renderer'
import { renderDocument } from '../../src/runtime/server/engine/render-document'
import {
  documentMeta,
  linkTargets,
  noteContent,
  pageSetupCases,
} from '../fixtures/corpus/annotations-data'
import {
  createReactAnnotationsDocument,
  createReactMetadataDocument,
  createReactPageSetupDocument,
} from '../fixtures/corpus/annotations-react'
import {
  VueAnnotationsDocument,
  VueMetadataDocument,
  VuePageSetupDocument,
} from '../fixtures/corpus/annotations-vue'
import { hasPdfHeader, installPdfCanvasGlobals, parsePdf } from '../utils/pdf'

// --- local render helpers (this wave may only add files; no shared helper edits) ---

const renderReact = async (
  element: Parameters<typeof renderReactDocument>[0],
): Promise<Uint8Array> => new Uint8Array(await renderReactDocument(element))

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

// --- local pdfjs inspection (utils/pdf.ts exposes text/links but not info,
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
    isEvalSupported: false,
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
const readMediaBoxes = (bytes: Uint8Array): Promise<Array<[number, number]>> =>
  withPdf(bytes, async (document) => {
    const boxes: Array<[number, number]> = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      try {
        const [x0, y0, x1, y1] = page.view
        boxes.push([round2(x1! - x0!), round2(y1! - y0!)])
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
  it('renders external http/mailto Link annotations identically to React', async () => {
    const [reactBytes, vueBytes] = await Promise.all([
      renderReact(createReactAnnotationsDocument()),
      renderVue(VueAnnotationsDocument),
    ])

    expect(hasPdfHeader(reactBytes)).toBe(true)
    expect(hasPdfHeader(vueBytes)).toBe(true)

    const [reactPdf, vuePdf] = await Promise.all([
      parsePdf(reactBytes),
      parsePdf(vueBytes),
    ])

    const links = (pdf: typeof reactPdf) => pdf.pages
      .flatMap(page => page.annotations)
      .filter(annotation => annotation.subtype === 'Link')

    const reactLinks = links(reactPdf)
    const vueLinks = links(vuePdf)

    // Renderer-boundary equality: whatever URIs React emits, Vue emits the same.
    expect(vueLinks).toEqual(reactLinks)

    // And the concrete claim: both external targets round-trip as their exact URI.
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
  })

  it('renders PdfNote content as a Text annotation identically to React', async () => {
    const [reactBytes, vueBytes] = await Promise.all([
      renderReact(createReactAnnotationsDocument()),
      renderVue(VueAnnotationsDocument),
    ])

    const [reactNotes, vueNotes] = await Promise.all([
      readNoteContents(reactBytes),
      readNoteContents(vueBytes),
    ])

    expect(vueNotes).toEqual(reactNotes)
    expect(vueNotes).toEqual([noteContent])
  })

  it('round-trips document metadata through the info dictionary like React', async () => {
    const [reactBytes, vueBytes] = await Promise.all([
      renderReact(createReactMetadataDocument()),
      renderVue(VueMetadataDocument),
    ])

    const [reactInfo, vueInfo] = await Promise.all([
      readInfoSubset(reactBytes),
      readInfoSubset(vueBytes),
    ])

    // Full-subset renderer equality first.
    expect(vueInfo).toEqual(reactInfo)

    // Then the concrete per-field claims (title/author/subject/keywords/
    // language/creationDate/pdfVersion all survive the round-trip).
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
    // React PDF serializes the Date as a PDF date string; assert the round-trip
    // encodes the pinned instant rather than a hard-coded string spelling.
    expect(vueInfo.CreationDate).toBe('D:20260720000000Z')
  })

  it('flows pdfVersion and pageLayout into the catalog like React', async () => {
    const [reactBytes, vueBytes] = await Promise.all([
      renderReact(createReactMetadataDocument()),
      renderVue(VueMetadataDocument),
    ])

    const [reactLayout, vueLayout] = await Promise.all([
      readPageLayout(reactBytes),
      readPageLayout(vueBytes),
    ])

    // pdfVersion is visible in the header; pdfjs also surfaces it as
    // PDFFormatVersion (asserted above). pageLayout lands in the catalog and
    // pdfjs exposes it PascalCased.
    expect(vueLayout).toBe(reactLayout)
    expect(vueLayout).toBe('TwoColumnLeft')
  })

  it('resolves page sizes, orientation, and dpi to the same MediaBox as React', async () => {
    const [reactBytes, vueBytes] = await Promise.all([
      renderReact(createReactPageSetupDocument()),
      renderVue(VuePageSetupDocument),
    ])

    const [reactBoxes, vueBoxes] = await Promise.all([
      readMediaBoxes(reactBytes),
      readMediaBoxes(vueBytes),
    ])

    expect(vueBoxes).toHaveLength(pageSetupCases.length)
    expect(reactBoxes).toHaveLength(pageSetupCases.length)

    // Renderer equality across every per-page size.
    expect(vueBoxes).toEqual(reactBoxes)

    // Independent oracle: each MediaBox matches the hand-computed dimensions,
    // proving both renderers agree with the spec and not merely with each other.
    const expected = pageSetupCases.map(pageCase => pageCase.expected)
    expect(vueBoxes).toEqual(expected)
  })
})
