import { Buffer } from 'node:buffer'
import { defineComponent, h, resolveComponent, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { createPdfTemplate } from '../src/runtime/server/registry'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import { PDF_DEFINITION_PROPERTY, type PdfDefinition } from '../src/runtime/shared/template'
import { installPdfCanvasGlobals, parsePdf, type ParsedPdf } from '../src/test/pdf'
import { renderPdfTemplate } from '../src/test/render-template'

const { PdfDocument, PdfLink, PdfPage, PdfPageCount, PdfPageNumber, PdfPageRef, PdfText, PdfView } = PDF_COMPONENTS

// Page tokens (`PdfPageNumber`, `PdfPageCount`) and `PdfPageRef` are the only
// way to print page numbers. These tests hold the invariants that used to be
// proven for the Vue page-number loop, now for the plain-data loop.

interface Section { id: string, title: string, lines: number }

// "Method" fills more than one page, so later sections start on pages that a
// wrong or unresolved map would not guess.
const SECTIONS: Section[] = [
  { id: 'intro', title: 'Introduction', lines: 3 },
  { id: 'method', title: 'Method', lines: 70 },
  { id: 'results', title: 'Results', lines: 3 },
  { id: 'appendix', title: 'Appendix', lines: 2 },
]

/** Where each section starts in the document above. */
const START_PAGES = { intro: 2, method: 3, results: 5, appendix: 6 }

const FOOTER_STYLE = {
  position: 'absolute',
  bottom: 24,
  left: 48,
  right: 48,
  fontSize: 9,
  textAlign: 'center',
  lineHeight: 2,
} as const

// Resolved by name, as a compiled pdfs/*.vue template does, so a primitive
// that is not registered in the render app fails here.
const tokenFooter = (): VNode =>
  h(PdfText, { fixed: true, style: FOOTER_STYLE }, () => [
    'Page ',
    h(resolveComponent('PdfPageNumber')),
    ' of ',
    h(resolveComponent('PdfPageCount')),
  ])

const report = (tocNumber: (section: Section) => VNode | string) =>
  h(PdfDocument, { title: 'Report', creationDate: new Date(0) }, () => [
    h(PdfPage, { size: 'A4', style: { padding: 48 } }, () => [
      h(PdfText, { style: { fontSize: 22, marginBottom: 16 } }, () => 'Contents'),
      ...SECTIONS.map(section =>
        h(PdfLink, { href: `#${section.id}`, style: { marginBottom: 8 } }, () =>
          h(PdfText, { style: { fontSize: 13 } }, () => {
            const number = tocNumber(section)
            // A page reference joins the text before it into one run (F6), so
            // the static twin writes one string, not two.
            return typeof number === 'string'
              ? `${section.title} ..... ${number}`
              : [`${section.title} ..... `, number]
          }))),
      tokenFooter(),
    ]),
    ...SECTIONS.map(section =>
      h(PdfPage, { size: 'A4', style: { padding: 48 } }, () => [
        // The destination is a view that spans pages for "Method", with a
        // bookmark and a nested bookmark, as the outline tests need.
        h(PdfView, {
          id: section.id,
          bookmark: { title: section.title, expanded: true },
        }, () => [
          h(PdfText, {
            bookmark: `${section.title} detail`,
            style: { fontSize: 20, marginBottom: 12 },
          }, () => `HEADING ${section.id}`),
          ...Array.from({ length: section.lines }, (_, index) =>
            h(PdfText, { style: { fontSize: 11, marginBottom: 4 } }, () =>
              `${section.title} line ${index + 1}`)),
        ]),
        tokenFooter(),
      ])),
  ])

/** Page numbers come only from the plain-data primitives. */
const PrimitivesReport = defineComponent(() => () =>
  report(section => h(resolveComponent('PdfPageRef'), { to: section.id })))

/** The same document with the final numbers written as static text. */
const StaticReport = defineComponent(() => () =>
  report(section => String(START_PAGES[section.id as keyof typeof START_PAGES])))

const pageTexts = (parsed: ParsedPdf): string[] =>
  parsed.pages.map(page => page.text)

const withDefinition = <C extends object>(component: C, definition: PdfDefinition): C =>
  Object.assign(component, { [PDF_DEFINITION_PROPERTY]: definition })

const readDestinationPage = async (bytes: Uint8Array, name: string): Promise<number> => {
  installPdfCanvasGlobals()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 })
  try {
    const document = await task.promise
    const destination = await document.getDestination(name) as [{ num: number, gen: number }]
    return (await document.getPageIndex(destination[0])) + 1
  }
  finally {
    await task.destroy()
  }
}

describe('plain-data page primitives', () => {
  it('renders a structured clone of the mounted tree to the same PDF', async () => {
    const mounted = await mountPdfComponent(PrimitivesReport)

    try {
      const tree = mounted.document
      // Throws a DataCloneError if a function, symbol, or proxy is in the tree.
      const clone = structuredClone(tree)
      const untouched = structuredClone(tree)

      const direct = await parsePdf((await renderPlainDocument(tree)).bytes)
      const cloned = await parsePdf((await renderPlainDocument(clone)).bytes)

      expect(direct.pageCount).toBe(6)
      expect(pageTexts(cloned)).toEqual(pageTexts(direct))
      expect(cloned.links).toEqual(direct.links)
      expect(cloned.outline).toEqual(direct.outline)

      // Layout wrote nothing back: no render callback, no resolved bookmark.
      expect(tree).toEqual(untouched)
    }
    finally {
      mounted.unmount()
    }
  })

  it('prints "Page X of Y" with the right numbers on every page', async () => {
    const { parsed, result } = await renderPdfTemplate(PrimitivesReport, {})

    expect(result.diagnostics.pageCount).toBe(6)
    parsed.pages.forEach((page, index) => {
      expect(page.text).toContain(`Page ${index + 1} of 6`)
    })
  })

  it('prints the page where each section starts, in two passes', async () => {
    const { parsed, result } = await renderPdfTemplate(PrimitivesReport, {})

    const contents = parsed.pages[0]!.text
    for (const section of SECTIONS) {
      const page = START_PAGES[section.id as keyof typeof START_PAGES]
      expect(contents).toContain(`${section.title} ..... ${page}`)
      expect(parsed.pages[page - 1]!.text).toContain(`HEADING ${section.id}`)
    }
    expect(parsed.links.map(link => link.destination)).toEqual(SECTIONS.map(section => section.id))
    expect(result.diagnostics.passes).toBe(2)
  })

  // Catches state that leaks from one layout pass into the next (a resolved
  // bookmark, a page-token line-height fix, cached layout data): the converged
  // two-pass render must equal one pass over the final numbers, byte for byte.
  it('writes the same bytes as one layout of the final numbers', async () => {
    const converged = await mountPdfComponent(PrimitivesReport)
    const fixed = await mountPdfComponent(StaticReport)
    try {
      const multi = await renderPlainDocument(converged.document, { compress: false })
      const single = await renderPlainDocument(fixed.document, { compress: false })

      expect(multi.passes).toBe(2)
      expect(single.passes).toBe(1)
      expect((await parsePdf(multi.bytes)).outline).toEqual((await parsePdf(single.bytes)).outline)
      expect(Buffer.from(multi.bytes).equals(Buffer.from(single.bytes))).toBe(true)
    }
    finally {
      converged.unmount()
      fixed.unmount()
    }
  })

  // A destination on a page-spanning view belongs to its first fragment. The
  // printed number and the PDF named destination are computed separately, so
  // both are checked.
  it('uses the start page of a section that spans pages', async () => {
    const { parsed, result } = await renderPdfTemplate(PrimitivesReport, {})
    const bytes = await result.toUint8Array()

    expect(parsed.pages[START_PAGES.method]!.text).toContain('Method line 70')
    expect(parsed.pages[0]!.text).toContain(`Method ..... ${START_PAGES.method}`)
    expect(await readDestinationPage(bytes, 'method')).toBe(START_PAGES.method)
  })

  // F3: the padding leaves room for one line of the target, and orphans need
  // two, so pagination keeps an empty fragment of the target (no line, but its
  // id) at the bottom of page 1 and puts all lines on page 2. An empty view is
  // a destination on its own.
  it('uses the page of the first line, not an empty fragment above it', async () => {
    const Document = defineComponent(() => () =>
      h(PdfDocument, null, () => h(PdfPage, { size: 'A4', style: { padding: 48 } }, () => [
        h(PdfView, { style: { paddingTop: 725 } }, () =>
          h(PdfText, { id: 'target', style: { fontSize: 11 } }, () => 'Target line one. Target line two. Target line three.'.repeat(4))),
        h(PdfView, { id: 'anchor' }),
        h(PdfText, null, () => ['Target on ', h(PdfPageRef, { to: 'target' }), ', anchor on ', h(PdfPageRef, { to: 'anchor' })]),
      ])))
    const { parsed, result } = await renderPdfTemplate(Document, {})
    const bytes = await result.toUint8Array()

    expect(parsed.pages[0]!.text).not.toContain('Target line')
    expect(parsed.pages[1]!.text).toContain('Target on 2, anchor on 2')
    expect(await readDestinationPage(bytes, 'target')).toBe(2)
    expect(await readDestinationPage(bytes, 'anchor')).toBe(2)
  })

  it.each([
    {
      name: 'a plain document',
      body: () => h(PdfText, null, () => 'Just a page.'),
    },
    {
      // A named destination resolves by name in one pass.
      name: 'a document with an internal link',
      body: () => [
        h(PdfLink, { href: '#target' }, () => 'Jump'),
        h(PdfText, { id: 'target', break: true }, () => 'Target'),
      ],
    },
  ])('lays out $name in one pass', async ({ body }) => {
    const Document = defineComponent(() => () =>
      h(PdfDocument, null, () => h(PdfPage, null, body)))
    const { result } = await renderPdfTemplate(Document, {})

    expect(result.diagnostics.passes).toBe(1)
  })

  it('names the template when page numbers do not settle within maxPasses', async () => {
    // Every PdfPageRef needs a second pass, so one pass cannot settle.
    const Report = withDefinition(defineComponent(() => () =>
      report(section => h(PdfPageRef, { to: section.id }))), { maxPasses: 1 })
    const template = createPdfTemplate('report', Report, { file: 'pdfs/report.vue' })
    const error = await template.render({}).then(() => null, (failure: unknown) => failure)

    expect(error).toBeInstanceOf(NuxtPdfError)
    expect(error).toMatchObject({
      code: PDF_ERROR_CODES.LimitExceeded,
      templateKey: 'report',
      message: expect.stringContaining('did not stabilize after 1 layout passes'),
    })
    expect((error as Error).message).toContain('pdfs/report.vue')
  })

  it('rejects a non-positive maxPasses at definePdf validation', () => {
    const Bad = withDefinition(defineComponent(() => () =>
      h(PdfDocument, null, () => h(PdfPage))), { maxPasses: 0 })

    expect(() => createPdfTemplate('bad', Bad, { file: 'pdfs/bad.vue' }))
      .toThrow(/maxPasses must be a positive integer/)
  })

  it.each([
    {
      name: 'a page number next to a nested element',
      body: () => h(PdfText, null, () => [
        'Page ',
        h(PdfPageNumber),
        h(PdfText, null, () => ' nested'),
      ]),
      message: 'cannot contain other elements',
    },
    {
      name: 'a page count in a nested PdfText',
      body: () => h(PdfText, null, () => [
        'Outer ',
        h(PdfText, null, () => h(PdfPageCount)),
      ]),
      message: 'nested inside another <PdfText>',
    },
    {
      name: 'a page reference to an id that does not exist',
      body: () => h(PdfText, null, () => h(PdfPageRef, { to: 'missing' })),
      message: '<PdfPageRef> destination does not match any id',
    },
    {
      name: 'a page number outside PdfText',
      body: () => h(PdfView, null, () => h(PdfPageNumber)),
      message: '<PdfView> cannot contain <PdfPageNumber>',
    },
    // Catches: removed API that fails without saying what replaces it.
    {
      name: 'the removed render prop',
      body: () => h(PdfText, { render: () => 'Page 1' }),
      message: 'Unsupported prop "render" on <PdfText>. Use <PdfPageNumber /> and <PdfPageCount /> inside the text.',
    },
    {
      name: 'the removed hyphenationCallback prop',
      body: () => h(PdfText, { hyphenationCallback: (word: string) => [word] }, () => 'x'),
      message: 'Unsupported prop "hyphenationCallback" on <PdfText>. Use :hyphenate="false".',
    },
    {
      name: 'a page reference directly in a link',
      body: () => [
        h(PdfLink, { href: '#target' }, () => h(PdfPageRef, { to: 'target' })),
        h(PdfText, { id: 'target' }, () => 'Target'),
      ],
      message: '<PdfLink> cannot contain <PdfPageRef>. Wrap it in <PdfText>.',
    },
  ])('rejects $name with PDF_TREE_INVALID', async ({ body, message }) => {
    const Invalid = defineComponent(() => () =>
      h(PdfDocument, null, () => h(PdfPage, null, body)))

    await expect(renderPdfTemplate(Invalid, {})).rejects.toMatchObject({
      code: PDF_ERROR_CODES.TreeInvalid,
      message: expect.stringContaining(message),
    })
  })
})
