import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { defineComponent, h, resolveComponent, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { createPdfFontStore } from '../src/runtime/server/engine/fonts'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { createPdfTemplate } from '../src/runtime/server/registry'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import type { PdfFontDataUrl } from '../src/runtime/fonts'
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

  // Twelve short texts, each on a page of its own: the summed heights suggest
  // one page, so the page tokens first keep one digit; the total of 12 needs
  // two, and the page builder pages again with room for them.
  it('prints two-digit numbers when the page count outgrows the first estimate', async () => {
    const Breaks = defineComponent(() => () =>
      h(PdfDocument, { title: 'Breaks', creationDate: new Date(0) }, () => [
        h(PdfPage, { size: 'A6', style: { padding: 24 } }, () => [
          h(PdfText, { fixed: true, style: { ...FOOTER_STYLE, textAlign: 'right' } }, () => ['Page ', h(PdfPageNumber), ' of ', h(PdfPageCount)]),
          ...Array.from({ length: 12 }, (_, index) => h(PdfText, { break: index > 0 }, () => `Part ${index + 1}`)),
        ]),
      ]))
    const { parsed } = await renderPdfTemplate(Breaks, {})

    expect(parsed.pages.map(page => page.text.match(/Page \d+ of \d+/)?.[0])).toEqual(Array.from({ length: 12 }, (_, index) => `Page ${index + 1} of 12`))
  })

  it('keeps room for as many digits as the page count has, on every page', async () => {
    // 'page 1' fits in 33 pt of Helvetica 10, 'page 11' does not: in a
    // 12-page document the number on page 1 takes the second line.
    const Narrow = defineComponent(() => () =>
      h(PdfDocument, { title: 'Narrow', creationDate: new Date(0) }, () => [
        h(PdfPage, { size: 'A6', style: { padding: 24 } }, () => [
          h(PdfText, { style: { width: 33, fontSize: 10 } }, () => ['page ', h(PdfPageNumber)]),
          ...Array.from({ length: 11 }, (_, index) => h(PdfText, { break: true }, () => `Part ${index + 2}`)),
        ]),
      ]))
    const { parsed } = await renderPdfTemplate(Narrow, {})

    expect(parsed.pages).toHaveLength(12)
    expect(parsed.pages[0]!.textRuns.map(run => run.text.trim())).toEqual(['page', '1'])
  })

  // Logical 'علم N عمل N مرحبا': the numbers join the Arabic run, so the
  // line shows right to left, each number a left-to-right range in it. The
  // room of two digits pushes مرحبا to a second line, where one digit fits it
  // on the first (as today's path lays it out). Catches a number painted at
  // its logical place in the visual line (other characters relabelled), and
  // a relabel that moves the places of a number not yet painted.
  it('paints page numbers in a right-to-left line at their visual places', async () => {
    const fonts = [{ family: 'Noto Arabic', src: `data:font/ttf;base64,${readFileSync(resolve(__dirname, 'fixtures/fonts/international/NotoSansArabic-Subset.ttf')).toString('base64')}` as PdfFontDataUrl }]
    const mounted = await mountPdfComponent(defineComponent(() => () =>
      h(PdfDocument, { title: 'Arabic', creationDate: new Date(0), language: 'ar' }, () => [
        h(PdfPage, { size: 'A6', style: { padding: 24 } }, () => [
          h(PdfText, { fixed: true, style: { fontFamily: 'Noto Arabic', fontSize: 20, width: 160 } }, () => ['علم ', h(PdfPageNumber), ' عمل ', h(PdfPageNumber), ' مرحبا']),
          ...Array.from({ length: 12 }, (_, index) => h(PdfText, { break: index > 0 }, () => `Part ${index + 1}`)),
        ]),
      ])))
    try {
      const { layout } = await renderPlainDocument(mounted.document, { fontStore: createPdfFontStore(fonts) })
      // Each line's runs in visual order, left to right: the Arabic words
      // stand reversed, the numbers in the places their room kept.
      const lines = layout.children.map(page => page.children!.find(node => node.props?.fixed)!.lines!.map(line =>
        line.runs.map(run => String.fromCodePoint(...run.glyphs.flatMap(glyph => glyph.codePoints)).trim()).filter(text => text !== '')))
      expect(lines).toEqual(layout.children.map((_, index) => [[String(index + 1), 'لمع', String(index + 1), 'ملع'], ['ابحرم']]))
    }
    finally {
      mounted.unmount()
    }
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
    ['on a page', { padding: 20 }, undefined],
    ['in a column container', { padding: 20 }, { columnCount: 2, columnFill: 'auto', columnGap: 10 }],
  ] as const)('uses the page where a nested text starts in a split paragraph: %s', async (_label, pageStyle, columns) => {
    const paragraph = () => h(PdfText, { style: { fontSize: 11 } }, () => [
      'Words fill the lines here. '.repeat(columns ? 100 : 70),
      h(PdfText, { id: 'late' }, () => 'Late'),
      ' ends it.',
    ])
    const Document = defineComponent(() => () =>
      h(PdfDocument, null, () => h(PdfPage, { size: 'A6', style: pageStyle }, () => [
        h(PdfText, null, () => ['Late on ', h(PdfPageRef, { to: 'late' })]),
        columns ? h(PdfView, { style: columns }, paragraph) : paragraph(),
      ])))
    const { parsed, result } = await renderPdfTemplate(Document, {})

    expect(parsed.pages.findIndex(page => page.text.includes('Late ends it')) + 1).toBe(2)
    expect(parsed.pages[0]!.text).toContain('Late on 2')
    expect(await readDestinationPage(await result.toUint8Array(), 'late')).toBe(2)
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
    const Report = (maxPasses: number) => withDefinition(defineComponent(() => () =>
      report(section => h(PdfPageRef, { to: section.id }))), { maxPasses })
    const template = createPdfTemplate('report', Report(1), { file: 'pdfs/report.vue' })
    const error = await template.render({}).then(() => null, (failure: unknown) => failure)

    expect(error).toBeInstanceOf(NuxtPdfError)
    expect(error).toMatchObject({
      code: PDF_ERROR_CODES.LimitExceeded,
      templateKey: 'report',
      message: expect.stringContaining('did not stabilize after 1 layout passes'),
    })
    expect((error as Error).message).toContain('pdfs/report.vue')
    // Catches a cap that runs one pass more or less, or a message that prints
    // one state twice: the one pass was fed nothing and produced the pages.
    expect((error as Error).message).toContain('Last fed: (empty); last produced: #intro→p2, #method→p3, #results→p5, #appendix→p6.')
    // Catches a cap that stops one pass early: two passes settle it.
    const settled = await createPdfTemplate('report', Report(2)).render({})
    expect(settled.diagnostics.passes).toBe(2)
  })

  // The engine used to give every text with a page token the font's normal
  // line height, whatever its lineHeight said.
  it('lays out a text with a page number at its lineHeight', async () => {
    const topOfNext = async (lineHeight: number) => {
      const { parsed } = await renderPdfTemplate(defineComponent(() => () => h(PdfDocument, null, () =>
        h(PdfPage, { size: 'A6', style: { padding: 20 } }, () => [
          h(PdfText, { fixed: true, style: { fontSize: 10, lineHeight } }, () => ['Page ', h(PdfPageNumber)]),
          h(PdfText, { style: { fontSize: 10 } }, () => 'Next'),
        ]))), {})
      return parsed.pages[0]!.textRuns.find(run => run.text === 'Next')!.y
    }

    expect(await topOfNext(1) - await topOfNext(3)).toBeCloseTo(20, 1)
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
      message: '<PdfPageRef> destination does not match any id in the document: to "missing". Give the target element id="missing" or correct "to".',
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
      message: 'Unsupported prop "hyphenationCallback" on <PdfText>. Words split only at their soft hyphens, unless the style key hyphens: "auto" splits them by the patterns of the document language.',
    },
    {
      name: 'the removed hyphenate prop',
      body: () => h(PdfText, { hyphenate: false }, () => 'x'),
      message: 'Unsupported prop "hyphenate" on <PdfText>. Words split only at their soft hyphens, unless the style key hyphens: "auto" splits them by the patterns of the document language.',
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

describe('page tokens in a decorated text', () => {
  // Pagination styles a page again for each relayout; a page token's text is
  // laid out anew each time. A style that inherited `underline` once and
  // inherited it again read `underline underline`, which is no decoration
  // (text/fragments.ts), so a page number inside a link lost its underline.
  const decorated = defineComponent(() => () => h(PdfDocument, null, {
    default: () => h(PdfPage, { size: 'A7', style: { padding: 12 } }, {
      default: () => [
        h(PdfLink, { href: 'https://example.test' }, { default: () => h(PdfText, null, { default: () => ['Page ', h(PdfPageNumber)] }) }),
        h(PdfView, { style: { textDecoration: 'line-through' } }, { default: () => h(PdfText, null, { default: () => ['Struck ', h(PdfPageNumber)] }) }),
      ],
    }),
  }))

  /** Where the stroked lines at each height end, from the page's content stream. */
  const lineEnds = (bytes: Uint8Array): Record<string, number> => {
    const streams = Buffer.from(bytes).toString('latin1').split('\nendstream').slice(0, -1).map(part => part.slice(part.lastIndexOf('stream\n') + 'stream\n'.length))
    const content = streams.flatMap((data) => {
      try {
        return [inflateSync(Buffer.from(data, 'latin1')).toString('latin1')]
      }
      catch {
        return []
      }
    }).join('\n')
    const ends: Record<string, number> = {}
    for (const [, , y, end] of content.matchAll(/([\d.]+) ([\d.]+) m\n([\d.]+) \2 l\n/g)) ends[y!] = Math.max(ends[y!] ?? 0, Number(end))
    return ends
  }

  it('keeps the underline and the strike of a page number', async () => {
    const { bytes } = await renderPdfTemplate(decorated, {})
    // "Page 1" ends at 56.322 pt, "Struck 1" at 65.934 pt. With the bug
    // the relaid-out texts had no line at all.
    expect(lineEnds(bytes)).toEqual({ 18.2: 56.322, 10.8: 65.934 })
  })
})
