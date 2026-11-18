import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import type { PdfDocumentProps } from '../src/runtime/primitives'
import { mountPdfComponent } from '../src/runtime/renderer'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import { PDF_DEFINITION_PROPERTY, PDF_SOURCE_PROP, type PdfDefinition } from '../src/runtime/shared/template'
import { normalizePdfLimits } from '../src/runtime/server/render-limits'
import { installPdfCanvasGlobals } from '../src/test/pdf'
import { renderPreparedPdfTemplate } from '../src/test/render-template'
import { actualTexts, pageContents, PARAGRAPH, renderTagged, ROBOTO, structuredChildren, TABLE_ROWS, TAGGED_PROPS } from './fixtures/tagged-document'

installPdfCanvasGlobals()

const {
  PdfDocument,
  PdfImage,
  PdfLink,
  PdfNote,
  PdfPage,
  PdfSvg,
  PdfText,
  PdfView,
} = PDF_COMPONENTS

const SAMPLE_PNG = new Uint8Array(readFileSync('test/fixtures/assets/sample.png'))
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

// ---------------------------------------------------------------------------
// Reading the PDF back
// ---------------------------------------------------------------------------

/** A structure node as pdfjs reports it, reduced to what the tests assert. */
type StructureNode = { role: string, alt?: string, children: StructureNode[] } | { content: string }

const reduce = (node: unknown): StructureNode => {
  const record = node as Record<string, unknown>
  if (record.type === 'content') return { content: String(record.id) }
  // pdfjs reports an object reference (OBJR, here an annotation) as `object`.
  if (record.type === 'object') return { content: `object ${String(record.id)}` }
  const children = Array.isArray(record.children) ? record.children.map(reduce) : []
  return { role: String(record.role), ...(typeof record.alt === 'string' ? { alt: record.alt } : {}), children }
}

/** The structure tree of each page and the named destinations, read with pdfjs. */
const readBack = async (bytes: Uint8Array, destinations: readonly string[] = []) => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 })
  const doc = await task.promise
  try {
    const pages: StructureNode[] = []
    for (let number = 1; number <= doc.numPages; number += 1) {
      pages.push(reduce(await (await doc.getPage(number)).getStructTree()))
    }
    const destinationPages: Record<string, number> = {}
    for (const id of destinations) {
      const destination = await doc.getDestination(id) as [{ num: number, gen: number }] | null
      if (destination !== null) destinationPages[id] = (await doc.getPageIndex(destination[0])) + 1
    }
    return { pages, markInfo: await doc.getMarkInfo(), destinationPages }
  }
  finally {
    await task.destroy()
  }
}

/** The elements below `Document` on one page: role and alt text. */
const elementsOf = (page: StructureNode): string[] => {
  if (!('role' in page)) return []
  const document = page.children.find(child => 'role' in child && child.role === 'Document')
  if (document === undefined || !('role' in document)) return []
  return document.children.flatMap(child => 'role' in child ? [child.alt === undefined ? child.role : `${child.role}:${child.alt}`] : [])
}

interface MarkedBlock { tag: string, lines: string[] }

/**
 * Split a content stream into its top-level marked-content blocks. Fails the
 * test on an operator outside any block, which PDF/UA forbids.
 */
const markedBlocks = (content: string): MarkedBlock[] => {
  const blocks: MarkedBlock[] = []
  let depth = 0
  for (const line of content.split('\n').filter(item => item !== '')) {
    const opens = /^\/(\w+) (?:BMC|<<.*>> BDC)$/.exec(line)
    if (opens) {
      if (depth === 0) blocks.push({ tag: opens[1]!, lines: [] })
      depth += 1
      continue
    }
    if (line === 'EMC') {
      depth -= 1
      continue
    }
    expect(depth, `operator outside marked content: ${line}`).toBeGreaterThan(0)
    blocks.at(-1)!.lines.push(line)
  }
  expect(depth).toBe(0)
  return blocks
}

/**
 * One element as `Role(kids)`: child elements, and `@` for an annotation
 * (an object reference); marked content is left out.
 */
const shape = (node: StructureNode): string => {
  if ('content' in node) return node.content.startsWith('object') ? '@' : ''
  const kids = node.children.map(shape).filter(kid => kid !== '')
  return kids.length === 0 ? node.role : `${node.role}(${kids.join(',')})`
}

/** The indirect objects of a PDF whose dictionaries are written uncompressed. */
const objectsOf = (bytes: Uint8Array): Map<string, string> =>
  new Map([...latin1(bytes).matchAll(/\n(\d+) 0 obj\n(<<[\s\S]*?>>)\nendobj/g)].map(match => [match[1]!, match[2]!.replace(/\n/g, ' ')]))

/** Every indirect object without a stream, whole (nested dictionaries included), on one line, by object number. */
const fullObjectsOf = (bytes: Uint8Array): Map<string, string> =>
  new Map([...latin1(bytes).matchAll(/(?:^|\n)(\d+) 0 obj\n([\s\S]*?)\nendobj/g)]
    .filter(match => !match[2]!.includes('\nstream\n'))
    .map(match => [match[1]!, match[2]!.replace(/\s+/g, ' ')]))

const errorOf = async (run: () => Promise<unknown>): Promise<NuxtPdfError> => {
  try {
    await run()
  }
  catch (error) {
    if (error instanceof NuxtPdfError) return error
    throw error
  }
  throw new Error('expected the render to fail')
}

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

describe('conformance="PDF/UA-1"', () => {
  // Catches wrong roles, a wrong reading order, a missing alt text, a
  // decorative image or running head that is tagged, and a paragraph that
  // splits into two elements. The split paragraph is the last element of
  // page 1 and the first of page 2.
  it('writes a structure tree that pdfjs reads back in reading order', async () => {
    const { bytes } = await renderTagged()
    const { pages, markInfo, destinationPages } = await readBack(bytes, ['split'])

    expect(pages.map(elementsOf)).toEqual([
      ['H1', 'P', 'P', 'P'],
      ['P', 'H2', 'Figure:A small sample chart', 'P'],
    ])
    expect(markInfo).toMatchObject({ Marked: true })
    // Catches the structure marker swallowing the author's id: the
    // destination of the split paragraph stays on its first page.
    expect(destinationPages).toEqual({ split: 1 })
  }, 60_000)

  // Catches a split paragraph written as two elements: one element must hold
  // a marked-content reference on each page.
  it('writes a split paragraph as one element with one marked-content sequence per page', async () => {
    const { bytes } = await renderTagged()
    const raw = latin1(bytes)
    // The engine writes one dictionary entry per line.
    const elements = [...raw.matchAll(/<<\n\/Type \/StructElem\n[\s\S]*?\nendobj/g)].map(match => match[0])
    const pagesOf = (element: string) => new Set([...element.matchAll(/\/Pg (\d+) 0 R/g)].map(match => match[1]))

    expect(elements.filter(element => pagesOf(element).size === 2)).toHaveLength(1)
    expect(elements.filter(element => element.includes('\n/S /P\n')).length).toBe(4)
  }, 60_000)

  // Catches content outside marked content (veraPDF 7.1-3) and a marked
  // sequence that is not exactly the node's own `q … Q` (the engine contract:
  // the destination call comes after the node's content, before its restore).
  // The decorative image is drawn in an artifact, the other in its figure.
  it('marks every operator as tagged content or an artifact', async () => {
    const { bytes } = await renderTagged()
    const contents = pageContents(bytes)
    expect(contents).toHaveLength(2)

    const blocks = contents.map(markedBlocks)
    for (const block of blocks.flat().filter(item => item.tag !== 'Artifact')) {
      expect(block.lines[0]).toBe('q')
      expect(block.lines.at(-1)).toBe('Q')
    }
    const images = (tag: string) => blocks[1]!.filter(block => block.tag === tag).flatMap(block => block.lines.filter(line => line.endsWith(' Do')))
    expect(images('Figure')).toHaveLength(1)
    expect(images('Artifact')).toHaveLength(1)
    // The running head (a fixed text) is an artifact: its glyphs are in the
    // first block of each page.
    for (const pageBlocks of blocks) {
      expect(pageBlocks[0]!.tag).toBe('Artifact')
      expect(pageBlocks[0]!.lines.some(line => line.endsWith(' TJ'))).toBe(true)
    }
  }, 60_000)

  // Catches a catalog or page dictionary without the entries PDF/UA-1 needs
  // (veraPDF 7.2-34 language, 7.1-10 DisplayDocTitle, 7.18.3 tab order, 6.2
  // pdfuaid) and an XMP packet without the title.
  it('writes the language, the title display, the tab order and the XMP identification', async () => {
    const { bytes } = await renderTagged()
    const raw = latin1(bytes)
    const xmp = Buffer.from(bytes).toString('utf8')

    expect(raw.startsWith('%PDF-1.7')).toBe(true)
    expect(raw).toMatch(/\/Lang \(en\)/)
    expect(raw).toMatch(/\/DisplayDocTitle true/)
    expect(raw).toMatch(/\/StructTreeRoot \d+ 0 R/)
    expect(raw.match(/\/Tabs \/S/g)).toHaveLength(2)
    expect(raw.match(/\/StructParents \d/g)).toHaveLength(2)
    expect(xmp).toContain('<pdfuaid:part>1</pdfuaid:part>')
    expect(xmp).toContain('Annual report &amp; outlook')
    expect(xmp).not.toContain('pdfaid:part')
    expect(raw).not.toContain('/OutputIntents')
  }, 60_000)

  // Catches a combined claim that drops one standard or writes an XMP packet
  // PDF/A rejects: PDF/A-3 needs an extension schema for pdfuaid.
  it('writes both identifications for a list with PDF/A-3b', async () => {
    const { bytes } = await renderTagged({ ...TAGGED_PROPS, conformance: ['PDF/A-3b', 'PDF/UA-1'] })
    const xmp = Buffer.from(bytes).toString('utf8')

    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>')
    expect(xmp).toContain('<pdfuaid:part>1</pdfuaid:part>')
    expect(xmp).toContain('<pdfaSchema:prefix>pdfuaid</pdfaSchema:prefix>')
    expect(latin1(bytes)).toContain('/OutputIntents')
    expect(latin1(bytes)).toMatch(/\/StructTreeRoot \d+ 0 R/)
  }, 60_000)
})

// ---------------------------------------------------------------------------
// Tables, links, lists (phase 15b)
// ---------------------------------------------------------------------------

describe('conformance="PDF/UA-1" with tables, links and lists', () => {
  const STRUCTURED = { ...TAGGED_PROPS, title: 'Structured report' }
  const renderStructured = (props: DocumentProps = STRUCTURED) => renderTagged(props, structuredChildren)

  // Catches a container written flat (rows or cells under Document), a list
  // without LI/LBody, a link without its annotation, an inline link or image
  // outside its paragraph, a block cell whose text loses its paragraph, and a
  // table that loses its header row or its colspan row. pdfjs gives every
  // page the whole tree, so page 1 shows it all.
  it('writes the nested structure that pdfjs reads back', async () => {
    const { bytes } = await renderStructured()
    const { pages } = await readBack(bytes)
    const document = (pages[0] as { children: StructureNode[] }).children[0]!

    const listItem = 'LI(LBody(P,P))'
    const rows = [
      'TR(TH,TH,TH)',
      'TR(TD(P),TD,TD)',
      ...Array.from({ length: TABLE_ROWS - 1 }, () => 'TR(TD,TD,TD)'),
      'TR(TD,TD)',
    ]
    expect(shape(document)).toBe([
      'Document(',
      `Sect(H1,P(Link(@),Link(@)),Link(@),L(${listItem},${listItem},${listItem}),BlockQuote(P),Figure,Caption(P),P(Figure),P),`,
      'H2,',
      `Table(${rows.join(',')})`,
      ')',
    ].join(''))
    expect(pages).toHaveLength(2)
  }, 60_000)

  // Catches a link annotation without its structure parent or description
  // (veraPDF 7.18.5), and a parent tree that does not lead from the
  // annotation back to the Link element that holds it.
  it('ties every link annotation to its Link element', async () => {
    const { bytes } = await renderStructured()
    const objects = objectsOf(bytes)
    const annotations = [...objects].filter(([, body]) => body.includes('/Subtype /Link'))
    const nums = /\/ParentTree << \/Nums \[(.*?)\] >>/.exec([...objects.values()].find(body => body.includes('/Type /StructTreeRoot'))!)![1]!
    const parentOf = (key: string) => new RegExp(`(?:^|\\s)${key} (\\d+) 0 R`).exec(nums)?.[1]

    expect(annotations.map(([, body]) => /\/Contents \((.*?)\)/.exec(body)?.[1])).toEqual(['online version', 'price table', 'example.com'])
    for (const [id, body] of annotations) {
      const key = /\/StructParent (\d+)/.exec(body)![1]!
      const element = objects.get(parentOf(key)!)!
      expect(element).toContain('/S /Link')
      expect(element).toContain(`/Type /OBJR /Pg`)
      expect(element).toMatch(new RegExp(`/Obj ${id} 0 R`))
    }
    // The internal link still jumps to the table's heading.
    expect([...objects.values()].some(body => body.includes('/S /GoTo') && body.includes('/D (prices)'))).toBe(true)
  }, 60_000)

  // Catches a parent tree that does not lead from marked content back to
  // its element: `ParentTreeNextKey` below the keys in use (a later key
  // would collide), a gap in the keys, or a page whose `StructParents` key
  // holds another page's array or a wrong order (MCID n must reach the
  // element whose MCR names that page and MCID n).
  it('keys the parent tree by page and annotation, and maps each MCID of a page to its element', async () => {
    const { bytes } = await renderStructured()
    const objects = fullObjectsOf(bytes)
    const root = [...objects.values()].find(body => body.includes('/Type /StructTreeRoot'))!
    const nums = /\/ParentTree << \/Nums \[(.*)\] >>/.exec(root)![1]!
    const entries = new Map([...nums.matchAll(/(\d+) (\[[^\]]*\]|\d+ 0 R)/g)].map(match => [Number(match[1]), match[2]!]))
    const next = Number(/\/ParentTreeNextKey (\d+)/.exec(root)![1])
    const pages = [...objects].filter(([, body]) => /\/Type \/Page\b/.test(body))
    const contents = pageContents(bytes)

    expect(pages).toHaveLength(2)
    expect([...entries.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: next }, (_, key) => key))
    pages.forEach(([pageId, body], pageIndex) => {
      const array = entries.get(Number(/\/StructParents (\d+)/.exec(body)![1]))!
      const elements = [...array.matchAll(/(\d+) 0 R/g)].map(match => match[1]!)
      const mcids = [...contents[pageIndex]!.matchAll(/\/MCID (\d+)/g)].map(match => Number(match[1]))

      expect(array.startsWith('[')).toBe(true)
      expect(mcids).toEqual(Array.from({ length: elements.length }, (_, mcid) => mcid))
      elements.forEach((element, mcid) => {
        expect(objects.get(element)).toMatch(new RegExp(`<< /Type /MCR /Pg ${pageId} 0 R /MCID ${mcid} >>`))
      })
    })
  }, 60_000)

  // Catches an engine update whose `PDFObject.convert` no longer writes the
  // plain JS values the structure tree is built from (CONTRACTS.md "Plain
  // dictionaries"), or a switch to pdfkit's number tree: the parent tree is a
  // direct dictionary, every element a StructElem dictionary, every kid an
  // MCR or OBJR dictionary or a reference, and an alt a text string.
  it('writes the structure tree as plain dictionaries', async () => {
    const { bytes } = await renderStructured()
    const objects = [...fullObjectsOf(bytes).values()]
    const root = objects.find(body => body.includes('/Type /StructTreeRoot'))!
    const catalog = objects.find(body => body.includes('/Type /Catalog'))!
    const elements = objects.filter(body => body.includes('/Type /StructElem'))

    expect(root).toMatch(/^<< \/Type \/StructTreeRoot \/K \d+ 0 R \/ParentTree << \/Nums \[0 .*\] >> \/ParentTreeNextKey \d+ >>$/)
    expect(root).not.toMatch(/\/Kids|\/Limits/)
    expect(catalog).toMatch(/\/StructTreeRoot \d+ 0 R/)
    expect(catalog).toMatch(/\/MarkInfo \d+ 0 R/)
    expect(objects).toContainEqual(expect.stringMatching(/^<< \/Marked true >>$/))
    expect(elements.length).toBeGreaterThan(80)
    for (const element of elements) {
      expect(element).toMatch(/^<< \/Type \/StructElem \/S \/\w+ \/P \d+ 0 R/)
      const kids = /\/K \[(.*)\]/.exec(element)?.[1] ?? /\/K (\d+ 0 R)/.exec(element)![1]!
      expect(kids.replace(/<< \/Type \/MCR \/Pg \d+ 0 R \/MCID \d+ >>|<< \/Type \/OBJR \/Pg \d+ 0 R \/Obj \d+ 0 R >>|\d+ 0 R/g, '').trim()).toBe('')
    }
    expect(elements.find(body => body.includes('/S /Figure'))).toContain('/Alt (A small sample chart)')
  }, 60_000)

  // Catches a repeated header tagged on every page (a screen reader would
  // read it twice), a header that is an artifact everywhere, and missing
  // table attributes: TH has scope column, the total cell spans two columns.
  it('tags the header on its first page, marks the repeat as pagination, and writes Scope and ColSpan', async () => {
    const { bytes } = await renderStructured()
    const objects = [...objectsOf(bytes).values()]
    const pageOf = (body: string) => new Set([...body.matchAll(/\/Pg (\d+) 0 R/g)].map(match => match[1]))
    const headers = objects.filter(body => body.includes('/S /TH'))
    const contents = pageContents(bytes)

    expect(headers).toHaveLength(3)
    for (const header of headers) {
      expect(header).toContain('/A << /O /Table /Scope /Column >>')
      expect(pageOf(header).size).toBe(1)
    }
    expect(new Set(headers.flatMap(header => [...pageOf(header)])).size).toBe(1)
    const pagination = markedBlocks(contents[1]!).filter(block => block.tag === 'Artifact' && block.lines.some(line => line.endsWith(' TJ')))
    expect(contents[1]!.match(/\/Artifact <<\/Type \/Pagination>> BDC/g)).toHaveLength(3)
    expect(pagination.length).toBeGreaterThanOrEqual(3)
    expect(contents[0]).not.toContain('/Pagination')
    expect(objects.filter(body => body.includes('/ColSpan'))).toEqual([expect.stringContaining('/A << /O /Table /ColSpan 2 >>')])
  }, 60_000)

  // Catches marked content that is not where the engine paints: an inline
  // link's sequence must be exactly its run (the annotation, the
  // attachments group and the one glyph group; the run's closing translate
  // starts the next part of the paragraph), an inline image its own
  // `q … Do … Q`, a decorative inline image an artifact between two parts of
  // its paragraph, and no operator may stay outside marked content.
  it('splits a paragraph around its inline links and images', async () => {
    const { bytes } = await renderStructured()
    const blocks = pageContents(bytes).map(markedBlocks)
    const first = blocks[0]!

    const links = first.filter(block => block.tag === 'Link')
    expect(links).toHaveLength(3)
    for (const block of links) {
      expect(block.lines[0]).toBe('q')
      expect(block.lines.at(-1)).toBe('Q')
      expect(block.lines.filter(line => line === 'BT')).toHaveLength(1)
    }
    for (const index of [0, 1]) {
      const position = first.indexOf(links[index]!)
      expect(first[position - 1]!.tag).toBe('P')
      expect(first[position + 1]!.tag).toBe('P')
      expect(first[position + 1]!.lines[0]).toMatch(/^1 0 0 1 [\d.]+ 0 cm$/)
    }
    const figures = first.filter(block => block.tag === 'Figure')
    expect(figures).toHaveLength(2)
    for (const block of figures) expect(block.lines.filter(line => line.endsWith(' Do'))).toHaveLength(1)
    const inlineFigure = first.indexOf(figures[1]!)
    expect(first[inlineFigure - 1]!.tag).toBe('P')
    const ornament = first.findIndex((block, index) => index > inlineFigure && block.tag === 'Artifact' && block.lines.some(line => line.endsWith(' Do')))
    expect(first[ornament - 1]!.tag).toBe('P')
    expect(first[ornament + 1]!.tag).toBe('P')
  }, 60_000)

  // Catches a paragraph that loses its inline elements' order: its kids are
  // its own parts with each Link between them, in paint order.
  it('keeps a paragraph\'s parts and its inline links in reading order', async () => {
    const { bytes } = await renderStructured()
    const objects = [...objectsOf(bytes).values()]
    const paragraph = objects.find(body => body.includes('/S /P ') && (body.match(/\d+ 0 R/g) ?? []).length >= 4 && body.includes('/MCID'))!
    const kids = /\/K \[(.*)\]/.exec(paragraph)![1]!.match(/<< \/Type \/MCR[^>]*>>|\d+ 0 R/g)!.filter(kid => !kid.startsWith(`${/\/P (\d+) 0 R/.exec(paragraph)![1]} 0 R`))

    expect(kids.map(kid => kid.startsWith('<<') ? 'MCR' : 'element')).toEqual(['MCR', 'element', 'MCR', 'element', 'MCR'])
  }, 60_000)

  // Catches the run-to-link mapping losing its place across a page break: a
  // paragraph split over two pages holds a link on each page (the second
  // with the same target as the first, after other text), so each
  // annotation must reach its own Link inside the one paragraph.
  it('maps the links of a paragraph split over two pages', async () => {
    const { bytes, parsed } = await renderTagged(UA, () => [page(() => [
      h(PdfText, null, () => [
        h(PdfLink, { href: 'https://example.com/a' }, () => 'first'),
        ` ${PARAGRAPH.repeat(10)}`,
        h(PdfLink, { href: 'https://example.com/a' }, () => 'second'),
        '.',
      ]),
    ])])
    const objects = objectsOf(bytes)
    const annotations = [...objects.values()].filter(body => body.includes('/Subtype /Link'))
    const links = [...objects.values()].filter(body => body.includes('/S /Link'))

    expect(parsed.pageCount).toBe(2)
    // One annotation per run: a link that wraps to the next line has two.
    expect(new Set(annotations.map(body => /\/Contents \((.*?)\)/.exec(body)?.[1]))).toEqual(new Set(['first', 'second']))
    expect(links).toHaveLength(2)
    expect(links.reduce((count, body) => count + (body.match(/\/Type \/OBJR/g) ?? []).length, 0)).toBe(annotations.length)
    expect(new Set(links.map(body => /\/P (\d+) 0 R/.exec(body)![1])).size).toBe(1)
    expect(links.map(body => new Set([...body.matchAll(/\/Pg (\d+) 0 R/g)].map(match => match[1])).size)).toEqual([1, 1])
    expect(links[0]!.match(/\/Pg (\d+)/)![1]).not.toBe(links[1]!.match(/\/Pg (\d+)/)![1])
  }, 60_000)

  // Catches two adjacent links with the same target written as one Link:
  // the second annotation would carry the first link's description, and a
  // screen reader would announce one link where the page shows two. The
  // empty text between the second pair adds no run of its own.
  it('writes each PdfLink as its own Link, also next to one with the same target', async () => {
    const href = 'https://example.com'
    const { bytes } = await renderTagged(UA, () => [page(() => [
      h(PdfText, null, () => [h(PdfLink, { href }, () => 'one'), h(PdfLink, { href }, () => 'two')]),
      h(PdfText, null, () => [h(PdfLink, { href: '#end' }, () => 'three'), h(PdfText, null, () => ''), h(PdfLink, { href: '#end' }, () => 'four')]),
      h(PdfText, { id: 'end' }, () => 'End'),
    ])])
    const objects = objectsOf(bytes)
    const annotations = [...objects.values()].filter(body => body.includes('/Subtype /Link'))
    const { pages } = await readBack(bytes)

    expect(shape((pages[0] as { children: StructureNode[] }).children[0]!)).toBe('Document(P(Link(@),Link(@)),P(Link(@),Link(@)),P)')
    expect(annotations.map(body => /\/Contents \((.*?)\)/.exec(body)?.[1])).toEqual(['one', 'two', 'three', 'four'])
    // pdfkit writes the target without the planner's per-link mark.
    const raw = latin1(bytes)
    expect(raw.match(/\/URI \(https:\/\/example\.com\)/g)).toHaveLength(2)
    expect(raw.match(/\/D \(end\)/g)).toHaveLength(2)
  }, 60_000)

  // Catches the debug overlay read as part of the text: `renderDebug` paints
  // its boxes and size label inside the text's `save`, so the label "250 x 11"
  // would join the paragraph's marked content. It must be an artifact, and
  // the paragraph keeps its source text.
  it('writes the debug overlay of a tagged text as an artifact', async () => {
    const { bytes } = await renderTagged(UA, () => [page(() => [
      h(PdfText, { debug: true, style: { textTransform: 'uppercase' } }, () => 'debug text'),
    ])])
    const content = pageContents(bytes)[0]!
    const blocks = markedBlocks(content)
    const paragraph = blocks.findIndex(block => block.tag === 'P')
    const overlay = blocks[paragraph + 1]!

    expect(blocks.filter(block => block.tag === 'P')).toHaveLength(1)
    expect(blocks[paragraph]!.lines.filter(line => line === 'BT')).toHaveLength(1)
    expect(overlay.tag).toBe('Artifact')
    expect(overlay.lines.filter(line => line === 'BT')).toHaveLength(1)
    expect(overlay.lines.some(line => line.endsWith(' re'))).toBe(true)
    expect(actualTexts(content)).toEqual([{ tag: 'P', mcid: 0, text: 'debug text' }])
  }, 60_000)

  // Catches PDF/A-3a written as level B, or without the structure tree it
  // exists for. Without PDF/UA-1 it needs no title and no pdfuaid.
  it('writes PDF/A-3a as conformance A with a structure tree', async () => {
    const { bytes } = await renderStructured({ ...STRUCTURED, title: undefined, conformance: 'PDF/A-3a' })
    const xmp = Buffer.from(bytes).toString('utf8')

    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>')
    expect(xmp).toContain('<pdfaid:conformance>A</pdfaid:conformance>')
    expect(xmp).not.toContain('pdfuaid')
    expect(latin1(bytes)).toMatch(/\/StructTreeRoot \d+ 0 R/)
    expect(latin1(bytes)).toContain('/OutputIntents')
  }, 60_000)
})

// ---------------------------------------------------------------------------
// Source text, figures with captions, row headers (phase 18)
// ---------------------------------------------------------------------------

describe('conformance="PDF/UA-1": source text, figures and row headers', () => {
  const EYEBROW = { textTransform: 'uppercase', letterSpacing: 1.6, fontSize: 7 } as const

  // Catches capitals or spaced letters reaching assistive technology without
  // the source text: a transformed or letter-spaced text carries its template
  // text, also when only a nested text is transformed, and a text-only cell
  // too; a plain text, a text with an inline link (its
  // parts would need their own source) and an artifact carry none.
  it('writes the source text of transformed and letter-spaced texts as ActualText', async () => {
    const { bytes } = await renderTagged(UA, () => [page(() => [
      h(PdfText, { tag: 'h1', style: { textTransform: 'capitalize' } }, () => 'annual report'),
      h(PdfText, { style: EYEBROW }, () => 'From the Managing Director'),
      h(PdfText, { style: { letterSpacing: 2 } }, () => 'Spaced out'),
      h(PdfText, null, () => ['Partly ', h(PdfText, { style: { textTransform: 'lowercase' } }, () => 'LOWER case')]),
      h(PdfText, null, () => 'Plain paragraph.'),
      h(PdfText, { style: EYEBROW }, () => ['See ', h(PdfLink, { href: 'https://example.com' }, () => 'the site')]),
      h(PdfText, { fixed: true, style: EYEBROW }, () => 'Running head'),
      h(PDF_COMPONENTS.PdfTable, { columns: [1] }, () => [
        h(PDF_COMPONENTS.PdfTableRow, null, () => [h(PDF_COMPONENTS.PdfTableCell, { style: EYEBROW }, () => 'Cell label')]),
      ]),
    ])])
    const [content] = pageContents(bytes)

    expect(actualTexts(content!).map(({ tag, text }) => ({ tag, text }))).toEqual([
      { tag: 'H1', text: 'annual report' },
      { tag: 'P', text: 'From the Managing Director' },
      { tag: 'P', text: 'Spaced out' },
      { tag: 'P', text: 'Partly LOWER case' },
      { tag: 'TD', text: 'Cell label' },
    ])
  }, 60_000)

  // Catches one source text for every page of a split text (a reader would
  // hear the whole paragraph twice), a part that loses or repeats words at
  // the page break or keeps the hyphen layout inserted, and ActualText where
  // it is not exact: `ß` becomes `SS`, so a page break inside that text
  // leaves both parts without it.
  it('writes the source text of each page\'s part of a split text, and none where it is not exact', async () => {
    const source = `${PARAGRAPH.repeat(9)}The end.`
    const split = (text: string) => renderTagged(UA, () => [page(() => [
      h(PdfText, { tag: 'h1' }, () => 'Title'),
      h(PdfText, { style: { textTransform: 'uppercase' } }, () => text),
    ])])

    const { bytes, parsed } = await split(source)
    const parts = pageContents(bytes).map(content => actualTexts(content).map(item => item.text))
    expect(parsed.pageCount).toBeGreaterThan(1)
    expect(parts.every(texts => texts.length === 1 && texts[0]!.length > 0)).toBe(true)
    expect(parts.flat().join('')).toBe(source)

    const sharp = await split(`Straße. ${source}`)
    expect(pageContents(sharp.bytes).map(content => actualTexts(content).length)).toEqual(parts.map(() => 0))
  }, 60_000)

  // Catches a figure written as loose content: the view is one Figure with
  // its alt text, the image and the label inside it are its content (no
  // Figure of their own, no alt needed), and the caption is a Caption inside
  // the Figure, after the image as in the template; the caption is ordinary
  // structure again, so it can hold a link. A decorative figure is an
  // artifact with its caption.
  it('writes a figure view as one Figure that holds its content and its caption', async () => {
    const { bytes } = await renderTagged(UA, () => [page(() => [
      h(PdfText, { tag: 'h1' }, () => 'Charts'),
      h(PdfView, { tag: 'figure', alt: 'Revenue grew in every quarter' }, () => [
        h(PdfText, { style: { fontSize: 6 } }, () => 'EUR thousand'),
        h(PdfImage, { src: SAMPLE_PNG, style: { width: 40, height: 20 } }),
        h(PdfSvg, { width: 10, height: 10 }, () => h(PDF_COMPONENTS.PdfRect, { x: 0, y: 0, width: 10, height: 10, fill: '#2F5D3A' })),
        h(PdfView, { tag: 'caption' }, () => h(PdfText, { style: { fontSize: 7 } }, () => [
          'Figure 1: revenue by quarter. Source: ',
          h(PdfLink, { href: 'https://example.com/data' }, () => 'statistics office'),
        ])),
      ]),
      h(PdfView, { tag: 'figure', decorative: true }, () => [
        h(PdfImage, { src: SAMPLE_PNG, style: { width: 10, height: 10 } }),
        h(PdfView, { tag: 'caption' }, () => h(PdfText, null, () => 'Ornament')),
      ]),
    ])])
    const { pages } = await readBack(bytes)
    const document = (pages[0] as { children: StructureNode[] }).children[0]!
    const figure = (document as { children: StructureNode[] }).children[1] as { role: string, alt?: string, children: StructureNode[] }

    expect(shape(document)).toBe('Document(H1,Figure(Caption(P(Link(@)))))')
    expect(figure.alt).toBe('Revenue grew in every quarter')
    // Label, image and graphic: three sequences of the Figure, then the Caption.
    expect(figure.children.map(child => 'content' in child ? 'MCR' : child.role)).toEqual(['MCR', 'MCR', 'MCR', 'Caption'])
    const blocks = markedBlocks(pageContents(bytes)[0]!)
    expect(blocks.filter(block => block.tag === 'Figure')).toHaveLength(3)
    expect(blocks.filter(block => block.tag === 'Artifact').flatMap(block => block.lines).filter(line => line.endsWith(' Do'))).toHaveLength(1)
  }, 60_000)

  // Catches a row header written as a data cell or as a column header: in a
  // body row `header` (also the template shorthand) makes a TH with scope
  // row, also for a cell with block content; in a header row the cells stay
  // column headers.
  it('writes a body cell with header as a row header', async () => {
    const { PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow } = PDF_COMPONENTS
    const { bytes } = await renderTagged(UA, () => [page(() => [
      h(PdfText, { tag: 'h1' }, () => 'Ledger'),
      h(PdfTable, { columns: [2, 1] }, () => [
        h(PdfTableHeader, null, () => [h(PdfTableCell, { header: true }, () => 'Line'), h(PdfTableCell, null, () => 'FY 2025')]),
        h(PdfTableRow, null, () => [h(PdfTableCell, { header: true }, () => 'Revenue'), h(PdfTableCell, null, () => '2,900')]),
        // `''` is what the template shorthand `<PdfTableCell header>` passes.
        h(PdfTableRow, null, () => [h(PdfTableCell, { header: '' as unknown as boolean }, () => h(PdfText, null, () => 'Costs')), h(PdfTableCell, null, () => '2,100')]),
      ]),
    ])])
    const objects = [...objectsOf(bytes).values()]
    const scopes = objects.flatMap((body) => {
      const role = /\/S \/(TH|TD) /.exec(body)?.[1]
      return role === undefined ? [] : [`${role}${/\/Scope \/(\w+)/.exec(body)?.[1] ?? ''}`]
    })

    expect(scopes).toEqual(['THColumn', 'THColumn', 'THRow', 'TD', 'THRow', 'TD'])
  }, 60_000)
})

// ---------------------------------------------------------------------------
// Documents without the claim
// ---------------------------------------------------------------------------

// sha256 of the plain document of `test/pdfa.test.ts`, rendered before phase 14.
const PLAIN_DOCUMENT_SHA256 = 'ece2a4a856d3ded19d7c3bd551f0b8c57c5cf9892935ee80be73afcb96362615'

describe('documents without the PDF/UA-1 claim', () => {
  // Catches tagging that leaks into ordinary documents, and the new props
  // changing the paint: the same document as in `test/pdfa.test.ts`, with
  // `tag`, `alt` and `decorative` added, writes the bytes it wrote before.
  it('write the same bytes as before, also with tag, alt and decorative', async () => {
    const { bytes } = await renderPreparedPdfTemplate(defineComponent(() => () => h(PdfDocument, {
      title: 'Plain & simple',
      author: 'Example Author',
      creationDate: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
    }, () => [
      h(PDF_COMPONENTS.PdfAttachment, { name: 'notes.txt', type: 'text/plain', data: 'notes' }),
      h(PDF_COMPONENTS.PdfAttachment, { name: 'raw.bin', data: 'no type' }),
      h(PdfPage, { size: 'A6' }, () => [
        h(PdfText, { tag: 'h1' }, () => 'Plain document'),
        h(PdfImage, { src: SAMPLE_PNG, alt: 'Sample', style: { width: 60 } }),
        h(PdfLink, { href: 'https://example.com', decorative: true }, () => h(PdfText, null, () => 'Link')),
      ]),
    ])), {})

    expect(latin1(bytes)).not.toContain('/StructTreeRoot')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PLAIN_DOCUMENT_SHA256)
  }, 60_000)

  // Catches the row-header mark or the figure props reaching layout: without
  // a tagged level, `header`, `tag="figure"` and its `alt` write the bytes of
  // the same document without them.
  it('write the same bytes with and without header and figure props', async () => {
    const { PdfTable, PdfTableCell, PdfTableRow } = PDF_COMPONENTS
    const render = (marked: boolean) => renderPreparedPdfTemplate(defineComponent(() => () => h(PdfDocument, {
      title: 'Ledger',
      creationDate: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
    }, () => [h(PdfPage, { size: 'A6' }, () => [
      h(PdfView, marked ? { tag: 'figure', alt: 'Sample' } : {}, () => h(PdfImage, { src: SAMPLE_PNG, style: { width: 30 } })),
      h(PdfTable, { columns: [2, 1] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, marked ? { header: true } : {}, () => 'Revenue'), h(PdfTableCell, null, () => '2,900')]),
        h(PdfTableRow, null, () => [h(PdfTableCell, marked ? { header: true } : {}, () => h(PdfText, null, () => 'Costs')), h(PdfTableCell, null, () => '2,100')]),
      ]),
    ])])), {})
    const [plain, marked] = await Promise.all([render(false), render(true)])

    expect(Buffer.from(marked.bytes).equals(Buffer.from(plain.bytes))).toBe(true)
  }, 60_000)
})

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

type DocumentProps = PdfDocumentProps & Record<string, unknown>

const page = (children: () => VNode[]) => h(PdfPage, { size: 'A6', style: { fontFamily: 'Roboto' } }, children)
const UA = { ...TAGGED_PROPS }

describe('PDF/UA-1 checks', () => {
  const invalid: Array<[string, DocumentProps, () => VNode[], string]> = [
    ['no title', { ...UA, title: undefined }, () => [page(() => [h(PdfText, null, () => 'x')])], '<PdfDocument> claims PDF/UA-1, which requires a "title": viewers show it in place of the file name.'],
    ['no language', { ...UA, language: undefined }, () => [page(() => [h(PdfText, null, () => 'x')])], '<PdfDocument> claims PDF/UA-1, which requires a "language", such as "en" or "de-CH".'],
    ['an image without alt', UA, () => [page(() => [h(PdfImage, { src: SAMPLE_PNG })])], '<PdfImage> needs "alt" (a short text that says what it shows) or "decorative" in a PDF/UA-1 document.'],
    ['an SVG without alt', UA, () => [page(() => [h(PdfSvg, { width: 10, height: 10 })])], '<PdfSvg> needs "alt" (a short text that says what it shows) or "decorative" in a PDF/UA-1 document.'],
    ['a first heading below h1', UA, () => [page(() => [h(PdfText, { tag: 'h2' }, () => 'x')])], '<PdfText tag="h2"> is the first heading of the document; a PDF/UA-1 document starts with tag="h1".'],
    ['a skipped heading level', UA, () => [page(() => [h(PdfText, { tag: 'h1' }, () => 'a'), h(PdfText, { tag: 'h2' }, () => 'b'), h(PdfText, { tag: 'h4' }, () => 'c')])], '<PdfText tag="h4"> skips a heading level: the heading before it is h2. Use tag="h3".'],
    ['a text in a standard font', UA, () => [h(PdfPage, { size: 'A6' }, () => [h(PdfText, null, () => 'x')])], 'PDF/UA-1 requires embedded fonts, but <PdfText> uses the standard font "Helvetica"'],
    ['PdfNote', UA, () => [page(() => [h(PdfNote, null, () => 'x')])], '<PdfNote> is not supported in a PDF/UA-1 document: a note is a pop-up outside the page content, so readers who cannot open it miss its text, and the engine writes it without an appearance. Print the note as <PdfText> instead.'],
    ['a link in a fixed node', UA, () => [page(() => [h(PdfView, { fixed: true }, () => h(PdfLink, { href: 'https://example.com' }, () => 'x'))])], '<PdfLink> inside a fixed or decorative node is not supported in a PDF/UA-1 document: every link must be in the reading order, and running content is an artifact. Move the link into the page flow.'],
    ['a decorative link in a text', UA, () => [page(() => [h(PdfText, null, () => ['x', h(PdfLink, { href: 'https://example.com', decorative: true }, () => 'y')])])], '<PdfLink> inside a fixed or decorative node is not supported in a PDF/UA-1 document'],
    ['a list item outside a list', UA, () => [page(() => [h(PdfView, { tag: 'list-item' }, () => h(PdfText, null, () => 'x'))])], '<PdfView tag="list-item"> must be a direct child of <PdfView tag="list">.'],
    ['a text directly in a list', UA, () => [page(() => [h(PdfView, { tag: 'list' }, () => h(PdfText, null, () => 'x'))])], '<PdfView tag="list"> holds <PdfView tag="list-item"> and <PdfView tag="caption"> elements only; wrap this <PdfText> in a list item.'],
    ['an inline image without alt', UA, () => [page(() => [h(PdfText, null, () => ['x', h(PdfImage, { src: SAMPLE_PNG })])])], '<PdfImage> needs "alt" (a short text that says what it shows) or "decorative" in a PDF/UA-1 document.'],
    ['two PDF/A levels', { ...UA, conformance: ['PDF/A-3b', 'PDF/A-3a'] }, () => [page(() => [h(PdfText, null, () => 'x')])], '<PdfDocument> requires "conformance" to be "PDF/A-3b", "PDF/A-3a" or "PDF/UA-1", or a list of them with at most one PDF/A level.'],
    ['PDF/A-3a without a language', { ...UA, conformance: 'PDF/A-3a', language: undefined }, () => [page(() => [h(PdfText, null, () => 'x')])], '<PdfDocument> claims PDF/A-3a, which requires a "language", such as "en" or "de-CH".'],
    ['a POSIX locale as language', { ...UA, conformance: 'PDF/A-3a', language: 'de_DE' }, () => [page(() => [h(PdfText, null, () => 'x')])], '<PdfDocument> claims PDF/A-3a, which requires "language" to be a language tag such as "en" or "de-CH"; "de_DE" is not one. Write "de-DE".'],
    ['a language that is not a tag', { ...UA, language: 'en-' }, () => [page(() => [h(PdfText, null, () => 'x')])], '<PdfDocument> claims PDF/UA-1, which requires "language" to be a language tag such as "en" or "de-CH"; "en-" is not one.'],
    ['a figure without alt in PDF/A-3a', { ...UA, conformance: 'PDF/A-3a' }, () => [page(() => [h(PdfImage, { src: SAMPLE_PNG })])], '<PdfImage> needs "alt" (a short text that says what it shows) or "decorative" in a PDF/A-3a document.'],
    ['an unknown level', { ...UA, conformance: 'PDF/UA-2' as never }, () => [page(() => [h(PdfText, null, () => 'x')])], '<PdfDocument> requires "conformance" to be "PDF/A-3b", "PDF/A-3a" or "PDF/UA-1", or a list of them with at most one PDF/A level.'],
    ['a level listed twice', { ...UA, conformance: ['PDF/UA-1', 'PDF/UA-1'] }, () => [page(() => [h(PdfText, null, () => 'x')])], '<PdfDocument> requires "conformance" to be "PDF/A-3b", "PDF/A-3a" or "PDF/UA-1", or a list of them with at most one PDF/A level.'],
    ['an empty list', { ...UA, conformance: [] }, () => [page(() => [h(PdfText, null, () => 'x')])], '<PdfDocument> requires "conformance" to be "PDF/A-3b", "PDF/A-3a" or "PDF/UA-1", or a list of them with at most one PDF/A level.'],
    ['a pdfVersion other than 1.7', { ...UA, conformance: ['PDF/A-3b', 'PDF/UA-1'], pdfVersion: '1.4' }, () => [page(() => [h(PdfText, null, () => 'x')])], '<PdfDocument> claims PDF/A-3b and PDF/UA-1, which is written as PDF 1.7; remove "pdfVersion" or set it to "1.7".'],
    ['an unknown text tag', UA, () => [page(() => [h(PdfText, { tag: 'h7' as never }, () => 'x')])], '<PdfText> requires "tag" to be "h1", "h2", "h3", "h4", "h5", "h6" or "p".'],
    ['an empty alt', UA, () => [page(() => [h(PdfImage, { src: SAMPLE_PNG, alt: ' ' })])], '<PdfImage> requires "alt" to be a non-empty string.'],
    ['a figure without alt', UA, () => [page(() => [h(PdfView, { tag: 'figure' }, () => h(PdfImage, { src: SAMPLE_PNG }))])], '<PdfView tag="figure"> needs "alt" (a short text that says what the figure shows) or "decorative" in a PDF/UA-1 document.'],
    ['a link in a figure', UA, () => [page(() => [h(PdfView, { tag: 'figure', alt: 'x' }, () => h(PdfLink, { href: 'https://example.com' }, () => 'y'))])], '<PdfLink> is not supported inside <PdfView tag="figure">: assistive technology reads the figure as its "alt", so the content inside it has no structure of its own. Move the link out of the figure or into its caption.'],
    ['a heading in a figure', UA, () => [page(() => [h(PdfText, { tag: 'h1' }, () => 'a'), h(PdfView, { tag: 'figure', alt: 'x' }, () => h(PdfText, { tag: 'h2' }, () => 'y'))])], '<PdfText tag="h2"> is not supported inside <PdfView tag="figure">'],
    ['a figure in a figure', UA, () => [page(() => [h(PdfView, { tag: 'figure', alt: 'x' }, () => h(PdfView, { tag: 'figure', alt: 'y' }))])], '<PdfView tag="figure"> is not supported inside <PdfView tag="figure">'],
    ['a table in a figure', UA, () => [page(() => [h(PdfView, { tag: 'figure', alt: 'x' }, () => h(PDF_COMPONENTS.PdfTable, { columns: [1] }, () => h(PDF_COMPONENTS.PdfTableRow, null, () => h(PDF_COMPONENTS.PdfTableCell, null, () => 'y'))))])], '<PdfTable> is not supported inside <PdfView tag="figure">'],
    ['alt on a view without tag="figure"', UA, () => [page(() => [h(PdfView, { tag: 'section', alt: 'x' })])], '"alt" on <PdfView> needs tag="figure": a plain view has no alternative text.'],
    ['a list in a link', UA, () => [page(() => [h(PdfLink, { href: 'https://example.com' }, () => h(PdfView, { tag: 'list' }, () => h(PdfView, { tag: 'list-item' }, () => h(PdfText, null, () => 'x'))))])], '<PdfView tag="list"> inside <PdfLink> is not supported in a PDF/UA-1 document: a link is inline content, so it cannot hold headings, sections, lists, quotes, captions, figures or tables, and their structure would be lost. Put the link inside the blocks instead, for example around the text of each list item.'],
    ['a heading in a view in a link', UA, () => [page(() => [h(PdfLink, { href: 'https://example.com' }, () => h(PdfView, null, () => h(PdfText, { tag: 'h1' }, () => 'x')))])], '<PdfText tag="h1"> inside <PdfLink> is not supported in a PDF/UA-1 document'],
    ['a table in a link', UA, () => [page(() => [h(PdfLink, { href: 'https://example.com' }, () => h(PDF_COMPONENTS.PdfTable, { columns: [1] }, () => h(PDF_COMPONENTS.PdfTableRow, null, () => h(PDF_COMPONENTS.PdfTableCell, null, () => 'y'))))])], '<PdfTable> inside <PdfLink> is not supported in a PDF/UA-1 document'],
    ['a tag on a nested text', UA, () => [page(() => [h(PdfText, null, () => ['x', h(PdfText, { tag: 'h1' }, () => 'y')])])], '"tag" is not supported on a <PdfText> nested inside another <PdfText>: the nested text is part of its parent.'],
  ]

  // Catches a document that claims PDF/UA-1 and is not: each rule fails the
  // render with a typed error that names the fix.
  it.each(invalid)('fails for %s', async (_label, props, children, message) => {
    const error = await errorOf(() => renderTagged(props, children))

    expect(error.code).toBe(PDF_ERROR_CODES.TreeInvalid)
    expect(error.message).toContain(message)
  }, 60_000)

  // Catches the checks firing inside artifacts: a figure in a decorative view
  // needs no alt, and a heading in a fixed node does not start the sequence.
  it('skips figures and headings inside fixed and decorative nodes', async () => {
    const { parsed } = await renderTagged(UA, () => [page(() => [
      h(PdfText, { fixed: true, tag: 'h3' }, () => 'Running head'),
      h(PdfView, { decorative: true }, () => h(PdfImage, { src: SAMPLE_PNG, style: { width: 10 } })),
      h(PdfText, { tag: 'h1' }, () => 'Title'),
    ])])

    expect(parsed.pageCount).toBe(1)
  }, 60_000)

  // Catches the tagged checks running before the definePdf values reach the
  // document: the definePdf title and language must count, and a definePdf
  // language must pass the same tag check.
  it('counts the title and language of definePdf', async () => {
    const withDefinition = (definition: PdfDefinition) => Object.assign(
      defineComponent(() => () => h(PdfDocument, { ...UA, title: undefined, language: undefined }, () => [page(() => [h(PdfText, null, () => 'x')])])),
      { [PDF_DEFINITION_PROPERTY]: definition },
    )
    const options = { fonts: [ROBOTO], limits: normalizePdfLimits(undefined) }

    const { bytes } = await renderPreparedPdfTemplate(withDefinition({ title: 'Report', language: 'en' }), {}, options)
    expect(latin1(bytes)).toContain('/Lang (en)')

    const error = await errorOf(() => renderPreparedPdfTemplate(withDefinition({ title: 'Report', language: 'de_DE' }), {}, options))
    expect(error.message).toContain('"de_DE" is not one. Write "de-DE".')
  }, 60_000)

  // Catches an error without the position of the node that caused it.
  it('names the source position of a figure without alt', async () => {
    const error = await errorOf(() => mountPdfComponent(defineComponent(() => () => h(PdfDocument, UA, () => [
      page(() => [h(PdfView, null, () => h(PdfImage, { [PDF_SOURCE_PROP]: 'report.vue:9:5', src: SAMPLE_PNG }))]),
    ]))))

    expect(error.source).toEqual({ file: 'report.vue', line: 9, column: 5 })
  })

  // Catches a figure error without the position of the node inside the figure.
  it('names the source position of a link inside a figure', async () => {
    const error = await errorOf(() => mountPdfComponent(defineComponent(() => () => h(PdfDocument, UA, () => [
      page(() => [h(PdfView, { tag: 'figure', alt: 'x' }, () => h(PdfLink, { [PDF_SOURCE_PROP]: 'report.vue:12:7', href: 'https://example.com' }, () => 'y'))]),
    ]))))

    expect(error.source).toEqual({ file: 'report.vue', line: 12, column: 7 })
  })
})
