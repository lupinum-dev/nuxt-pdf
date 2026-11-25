import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineComponent, h, type Component, type VNodeChild } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import type { PdfFontDataUrl } from '../src/runtime/fonts'
import { PDF_FOOTNOTE_REPEAT_PROP, PDF_PRIMITIVES } from '../src/runtime/primitives'
import { mountPdfComponent } from '../src/runtime/renderer'
import type { PdfNode } from '../src/runtime/renderer/types'
import { createPdfFontStore } from '../src/runtime/server/engine/fonts'
import { numberFootnotesByPage } from '../src/runtime/server/engine/footnote-numbers'
import { findShrinkCandidates } from '../src/runtime/server/engine/layout-diagnostics'
import { layoutPdfTree } from '../src/runtime/server/engine/layout-pass'
import { NUMBER_RESERVE_PROP } from '../src/runtime/server/engine/layout/text/fragments'
import type { ElementNode, LaidOutNode, LayoutNode } from '../src/runtime/server/engine/layout/types'
import { renderPlainDocument, toEngineDocument, type PlainLayoutFacts } from '../src/runtime/server/engine/plain-tree'
import type { Line } from '../src/runtime/server/engine/text'
import { textWidth } from '../src/runtime/server/engine/text/metrics'
import { installPdfCanvasGlobals, parsePdf, type ParsedPdf } from '../src/test/pdf'
import { renderPdfTemplate, renderPreparedPdfTemplate } from '../src/test/render-template'

installPdfCanvasGlobals()

// The fixtures pass wrong values on purpose, which the typed props reject,
// so the components are used as plain Vue components here.
const PLAIN: Readonly<Record<keyof typeof PDF_COMPONENTS, Component>> = PDF_COMPONENTS
const { PdfDocument, PdfFootnote, PdfLink, PdfPage, PdfPageNumber, PdfRichText, PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfText, PdfView } = PLAIN

const documentWith = (children: () => VNodeChild, documentProps: Record<string, unknown> = {}) =>
  defineComponent(() => () => h(PdfDocument, documentProps, () => h(PdfPage, null, children)))

describe('PdfFootnote at mount', () => {
  // Each row is a place where a footnote's note would print wrongly or not at
  // all: on every page (fixed), inside another note, inside the link its own
  // mark would be, or with no place in a text.
  it.each<[string, () => VNodeChild, Record<string, unknown>, string]>([
    ['in a fixed node', () => h(PdfView, { fixed: true }, () => h(PdfText, () => ['Head', h(PdfFootnote, () => 'Note.')])), {},
      '<PdfFootnote> cannot be inside a fixed node (a <PdfTableHeader> is one): a fixed node repeats on every page, and so would its note. Move the footnote into the page flow.'],
    ['in a table header', () => h(PdfTable, { columns: [1] }, () => h(PdfTableHeader, () => h(PdfTableCell, () => h(PdfText, () => ['Price', h(PdfFootnote, () => 'Net.')])))), {},
      '<PdfFootnote> cannot be inside a fixed node (a <PdfTableHeader> is one): a fixed node repeats on every page, and so would its note. Move the footnote into the page flow.'],
    ['in the note of another footnote', () => h(PdfText, () => ['Body', h(PdfFootnote, () => ['Note', h(PdfText, () => ['inner', h(PdfFootnote, () => 'Deeper.')])])]), {},
      '<PdfFootnote> cannot be inside the note of another <PdfFootnote>: a note has no notes. Write it as its own footnote in the text.'],
    ['in a text inside a link', () => h(PdfText, () => ['See ', h(PdfLink, { href: 'https://example.test' }, () => h(PdfText, () => ['the site', h(PdfFootnote, () => 'Note.')]))]), {},
      '<PdfFootnote> cannot be inside <PdfLink>: its mark is a link to the note, and a link cannot hold a link. Put the footnote next to the link.'],
    ['directly in a link', () => h(PdfText, () => ['See ', h(PdfLink, { href: 'https://example.test' }, () => h(PdfFootnote, () => 'Note.'))]), {},
      'Invalid PDF nesting: <PdfLink> cannot contain <PdfFootnote>. Its mark is a link to the note, and a link cannot hold a link: put the footnote in the <PdfText> next to the <PdfLink>.'],
    ['directly in a footnote', () => h(PdfText, () => ['Body', h(PdfFootnote, () => ['Note', h(PdfFootnote, () => 'Deeper.')])]), {},
      'Invalid PDF nesting: <PdfFootnote> cannot contain <PdfFootnote>. A footnote cannot hold another footnote: write the second note as its own <PdfFootnote> in the text.'],
    ['outside a text', () => h(PdfView, () => h(PdfFootnote, () => 'Note.')), {},
      'Invalid PDF nesting: <PdfView> cannot contain <PdfFootnote>. A footnote marks a place in a text: put it inside a <PdfText>.'],
    ['with no note', () => h(PdfText, () => ['Body', h(PdfFootnote, () => '  ')]), {},
      '<PdfFootnote> has no note: its content is the text that prints at the bottom of the page. Write the note inside it.'],
    ['with a page number in its note', () => h(PdfText, () => ['Body', h(PdfFootnote, () => ['See page ', h(PdfText, () => h(PdfPageNumber))])]), {},
      '<PdfPageNumber> cannot be inside <PdfFootnote>: the notes are laid out before the pages are known. Write the number in the text next to the footnote, or use <PdfPageRef>.'],
    ['with a style of its own', () => h(PdfText, () => ['Body', h(PdfFootnote, { style: { color: '#555555' } }, () => 'Note.')]), {},
      '<PdfFootnote> takes no style or class: it stands for the mark and the note at once. Style the note with "footnoteStyles.note" on <PdfDocument>, and the mark with "footnoteStyles.mark".'],
    ['with a fixed text in its note', () => h(PdfText, () => ['Body', h(PdfFootnote, () => ['Note ', h(PdfText, { fixed: true }, () => 'inner')])]), {},
      '<PdfText> cannot have "fixed" inside <PdfFootnote>: the note is laid out once, at the bottom of the page of its mark. Remove "fixed".'],
    ['with a bookmark in its note', () => h(PdfText, () => ['Body', h(PdfFootnote, () => ['Note ', h(PdfText, { bookmark: 'Inner' }, () => 'inner')])]), {},
      '<PdfText> cannot have "bookmark" inside <PdfFootnote>: the note is laid out once, at the bottom of the page of its mark. Remove "bookmark".'],
    ['next to a text with the id of a note', () => h(PdfText, { id: '__nuxtPdfFootnote-1' }, () => ['Body', h(PdfFootnote, () => 'Note.')]), {},
      '<PdfText id="__nuxtPdfFootnote-1"> has an id that starts with "__nuxtPdfFootnote-", which the notes of footnotes use. Use another id.'],
    ['with an unknown numbering', () => h(PdfText, () => ['Body', h(PdfFootnote, () => 'Note.')]), { footnotes: 'chapter' },
      '<PdfDocument> requires "footnotes" to be "document" or "page". Got "chapter".'],
  ])('rejects a footnote %s', async (_name, children, documentProps, message) => {
    await expect(mountPdfComponent(documentWith(children, documentProps))).rejects.toMatchObject({ code: 'PDF_TREE_INVALID', message })
  })

  // Each row is footnote styles the layout would misread or ignore.
  it.each<[string, unknown, string]>([
    ['not an object', 'small', '<PdfDocument> requires "footnoteStyles" to be an object with the styles "mark", "note", "area" and "rule". Got "small".'],
    ['an unknown part', { line: { borderTopWidth: 1 } }, '<PdfDocument> "footnoteStyles" has no part "line". Use mark, note, area or rule.'],
    ['a rule that is not a style', { rule: true }, '<PdfDocument> "footnoteStyles.rule" must be a style object, or false for no rule. Got true.'],
    ['a part that is not a style', { note: 'small' }, '<PdfDocument> "footnoteStyles.note" must be a style object. Got "small".'],
    ['an invalid style value', { mark: { fontSize: -1 } }, '<PdfDocument footnoteStyles.mark> :style value -1 for "fontSize" is invalid: expected a value above 0.'],
    ['a key that moves the area', { area: { position: 'absolute' } }, '<PdfDocument> "footnoteStyles.area" cannot set "position": the layout places the notes at the bottom of the page. Remove it.'],
    ['a height on the area', { area: { maxHeight: 100 } }, '<PdfDocument> "footnoteStyles.area" cannot set "maxHeight": the layout places the notes at the bottom of the page. Remove it.'],
    ['a margin the layout replaces', { area: { marginBottom: 4 } }, '<PdfDocument> "footnoteStyles.area" cannot set "marginBottom": the layout places the area and keeps only its marginTop, the least space above the notes. Remove it.'],
    ['a key that moves the rule', { rule: { left: 10 } }, '<PdfDocument> "footnoteStyles.rule" cannot set "left": the layout places the notes at the bottom of the page. Remove it.'],
    ['a raised note', { note: { verticalAlign: 'super' } }, '<PdfDocument> "footnoteStyles.note" cannot set verticalAlign "super": only the mark is raised or lowered.'],
  ])('rejects footnoteStyles with %s', async (_name, footnoteStyles, message) => {
    await expect(mountPdfComponent(documentWith(() => h(PdfText, () => ['Body', h(PdfFootnote, () => 'Note.')]), { footnoteStyles }))).rejects.toMatchObject({ code: 'PDF_TREE_INVALID', message })
  })

  // Catches a context rule that is too wide: a footnote in a nested text, in
  // a table cell and next to a link is where authors put them, with the
  // three footnote styles.
  it('mounts footnotes in a text, a nested text, a table cell and next to a link', async () => {
    const mounted = await mountPdfComponent(documentWith(() => [
      h(PdfText, () => ['Peat', h(PdfFootnote, () => ['Source, ', h(PdfLink, { href: 'https://example.test' }, () => 'page 12'), '.'])]),
      h(PdfText, () => [h(PdfText, { style: { fontWeight: 700 } }, () => ['Bold', h(PdfFootnote, () => 'Note.')]), ' and ', h(PdfLink, { href: 'https://example.test' }, () => 'a link'), h(PdfFootnote, () => 'After the link.')]),
      h(PdfTable, { columns: [1] }, () => h(PdfTableRow, () => h(PdfTableCell, () => ['Cell', h(PdfFootnote, () => 'In a cell.')]))),
    ], { footnotes: 'page', footnoteStyles: { mark: { color: '#555555' }, note: { fontSize: '90%' }, area: { marginTop: 12, gap: 2 }, rule: { width: '100%', borderTopColor: '#999999' } } }))
    mounted.unmount()
  })
})

describe('PdfFootnote from rich text', () => {
  /** Each footnote of the mounted tree in order: its note text, or the note it marks again. */
  const footnotesOf = (node: PdfNode): Array<string | number> => {
    if (node.type === PDF_PRIMITIVES.TextInstance) return []
    if (node.type !== PDF_PRIMITIVES.Footnote) return node.children.flatMap(footnotesOf)
    const repeat = node.props[PDF_FOOTNOTE_REPEAT_PROP]
    if (typeof repeat === 'number') return [repeat]
    const text = (child: PdfNode): string => child.type === PDF_PRIMITIVES.TextInstance ? child.value : child.children.map(text).join('')
    return [node.children.map(text).join('')]
  }

  // Catches a repeat that renders a second note, or names the wrong note.
  it('renders each note once and a repeat as the place of its note', async () => {
    const html = '<p>A<sup class="footnote-ref"><a href="#fn1">1</a></sup> B<sup class="footnote-ref"><a href="#fn2">2</a></sup> C<sup class="footnote-ref"><a href="#fn2">2</a></sup></p>'
      + '<section class="footnotes"><ol><li id="fn1">First.</li><li id="fn2">Second, <b>bold</b>.</li></ol></section>'
    const mounted = await mountPdfComponent(documentWith(() => h(PdfRichText, { html })))
    try {
      expect(footnotesOf(mounted.document)).toEqual(['First.', 'Second, bold.', 2])
    }
    finally {
      mounted.unmount()
    }
  })
})

describe('PdfFootnote in the engine tree', () => {
  const NO_FACTS: PlainLayoutFacts = { destinations: {}, breaks: [] }

  const engineTree = async (component: Component, facts = NO_FACTS) => {
    const mounted = await mountPdfComponent(component)
    try {
      return toEngineDocument(mounted.document, facts)
    }
    finally {
      mounted.unmount()
    }
  }

  const elements = (nodes: readonly LayoutNode[] = []): ElementNode[] =>
    nodes.flatMap(node => node.type === PDF_PRIMITIVES.TextInstance ? [] : [node, ...elements(node.children)])

  const textOf = (node: LayoutNode): string =>
    node.type === PDF_PRIMITIVES.TextInstance ? node.value : (node.children ?? []).map(textOf).join('')

  /** Each mark in the page content in order: the note it links to and its number. */
  const marksOf = (pages: readonly LayoutNode[]): string[] =>
    elements(pages).flatMap(node => typeof node.props.href === 'string' && node.props.href.startsWith('#__nuxtPdfFootnote-')
      ? [`${node.props.href} ${textOf(node)}`]
      : [])

  // Catches a note on the wrong page, a mark that links to another note than
  // its own, a note without its number, and footnote styles that replace the
  // defaults instead of merging over them.
  it('hands each page its notes, their marks and the note area', async () => {
    const { document } = await engineTree(defineComponent(() => () => h(PdfDocument, { footnoteStyles: { mark: { color: '#555555' }, area: { gap: 2 }, rule: { borderTopColor: '#999999' } } }, () => [
      h(PdfPage, null, () => h(PdfText, () => ['Peat', h(PdfFootnote, () => ['Source, ', h(PdfText, { style: { fontWeight: 700 } }, () => 'bold'), '.'])])),
      h(PdfPage, null, () => [h(PdfText, () => 'No note.'), h(PdfText, () => ['Moss', h(PdfFootnote, () => 'Second.')])]),
      h(PdfPage, null, () => h(PdfText, () => 'No note.')),
    ])))
    const mark = { verticalAlign: 'super', fontSize: '70%' }
    const rule = { type: PDF_PRIMITIVES.View, box: {}, props: {}, children: [], style: [{ width: '33%', borderTopWidth: 0.5, marginBottom: 4 }, { borderTopColor: '#999999' }] }
    const area = { type: PDF_PRIMITIVES.View, props: {}, children: [rule], style: [{ marginTop: 8, fontSize: '85%' }, { gap: 2 }] }
    const note = (n: number, content: string) => ({
      type: PDF_PRIMITIVES.Text,
      props: { id: `__nuxtPdfFootnote-${n}`, __nuxtPdfNoteNumber: n },
      style: {},
      children: [{ type: PDF_PRIMITIVES.Text, box: {}, props: { href: `#__nuxtPdfFootnote-${n}-ref` }, style: [mark, { color: '#555555' }], children: [{ type: PDF_PRIMITIVES.TextInstance, value: String(n) }] }, { type: PDF_PRIMITIVES.TextInstance, value: ' ' }],
      text: content,
    })
    const [first, second, third] = document.children
    expect([first, second, third].map(page => (page?.notes ?? []).map(({ type, props, style, children = [] }) => ({ type, props, style, children: children.slice(0, 2), text: textOf({ type, props, box: {}, children: children.slice(2) }) })))).toEqual([
      [note(1, 'Source, bold.')],
      [note(2, 'Second.')],
      [],
    ])
    expect([first?.noteArea, second?.noteArea, third?.noteArea]).toMatchObject([area, area, undefined])
    expect(marksOf(document.children)).toEqual(['#__nuxtPdfFootnote-1 1', '#__nuxtPdfFootnote-2 2'])
    expect(elements(document.children).find(node => node.props.href === '#__nuxtPdfFootnote-1')?.style).toEqual([mark, { color: '#555555' }])
  })

  // Catches a rule that stays when the author turns it off.
  it('leaves the rule out with rule: false', async () => {
    const { document } = await engineTree(documentWith(() => h(PdfText, () => ['A', h(PdfFootnote, () => 'One.')]), { footnoteStyles: { rule: false } }))
    expect(document.children[0]?.noteArea).toMatchObject({ type: PDF_PRIMITIVES.View, style: { marginTop: 8, fontSize: '85%' }, children: [] })
  })

  // The engine tree numbers through the document. Per page, each mark and
  // note number is also laid out in its font's widest digit, as many as the
  // number has, and the page walk prints the page's number after layout.
  // Catches a per-page number without the reserve (its line keeps a width
  // the page's number may not fit), a number through the document in widest
  // digits, and per-page numbers read from the pages of a pass.
  it.each<[string, Record<string, unknown>, boolean]>([
    ['per page', { footnotes: 'page' }, true],
    ['through the document', {}, false],
  ])('numbers footnotes %s in the engine tree', async (_name, documentProps, byPage) => {
    const engine = await engineTree(documentWith(() => [
      h(PdfText, () => ['A', h(PdfFootnote, () => 'One.')]),
      h(PdfText, () => ['B', h(PdfFootnote, () => 'Two.'), ' C', h(PdfFootnote, () => 'Three.')]),
    ], documentProps), { ...NO_FACTS, destinations: { '__nuxtPdfFootnote-1-ref': 1, '__nuxtPdfFootnote-2-ref': 2, '__nuxtPdfFootnote-3-ref': 2 } })
    const notes = engine.document.children[0]?.notes ?? []
    expect(marksOf(engine.document.children).map(mark => mark.split(' ')[1])).toEqual(['1', '2', '3'])
    expect(notes.map(note => textOf(note.children?.[0] ?? { type: PDF_PRIMITIVES.TextInstance, value: '' }))).toEqual(['1', '2', '3'])
    const numbers = elements([...engine.document.children, ...notes]).filter(node => typeof node.props.href === 'string' && node.props.href.startsWith('#__nuxtPdfFootnote-'))
    expect(numbers.map(node => node.props[NUMBER_RESERVE_PROP] === true)).toEqual(Array.from({ length: 6 }, () => byPage))
    expect(engine.numbersFootnotesByPage).toBe(byPage)
  })

  // Catches a repeated rich-text reference that makes a second note, or
  // takes the next number instead of the number of its note.
  it('gives a repeated rich-text reference the mark of its note', async () => {
    const html = '<p>A<sup class="footnote-ref"><a href="#fn1">1</a></sup> B<sup class="footnote-ref"><a href="#fn2">2</a></sup> C<sup class="footnote-ref"><a href="#fn2">2</a></sup></p>'
      + '<section class="footnotes"><ol><li id="fn1">First.</li><li id="fn2">Second.</li></ol></section>'
    const { document } = await engineTree(documentWith(() => [h(PdfRichText, { html }), h(PdfText, () => ['After', h(PdfFootnote, () => 'Third.')])]))
    expect(marksOf(document.children)).toEqual(['#__nuxtPdfFootnote-1 1', '#__nuxtPdfFootnote-2 2', '#__nuxtPdfFootnote-2 2', '#__nuxtPdfFootnote-3 3'])
    expect(document.children[0]?.notes?.map(note => note.props.id)).toEqual(['__nuxtPdfFootnote-1', '__nuxtPdfFootnote-2', '__nuxtPdfFootnote-3'])
  })
})

describe('PdfFootnote in the PDF', () => {
  // 300 × 200 pt, 20 pt padding, 10 pt text: the marks print at 7 pt (70 %),
  // the notes at 8.5 pt (85 %) and their numbers at 5.95 pt.
  const sheet = (children: () => VNodeChild) => h(PdfPage, { size: [300, 200], style: { padding: 20, fontSize: 10, fontFamily: 'Helvetica' } }, children)
  const renderWithResult = async (documentProps: Record<string, unknown>, pages: () => VNodeChild) =>
    renderPdfTemplate(defineComponent(() => () => h(PdfDocument, documentProps, pages)), {})
  const render = async (documentProps: Record<string, unknown>, pages: () => VNodeChild) => {
    const { parsed, result, bytes } = await renderWithResult(documentProps, pages)
    return { parsed, bytes, passes: result.diagnostics.passes }
  }
  /** The page and the top (from the page top) of each named destination, as a viewer reads them. */
  const destinationsOf = async (bytes: Uint8Array, names: readonly string[]) => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 })
    const doc = await task.promise
    try {
      return await Promise.all(names.map(async (name) => {
        const destination = await doc.getDestination(name)
        if (destination === null) return `${name} missing`
        const [ref, , , top] = destination
        const page = await doc.getPage((await doc.getPageIndex(ref)) + 1)
        return `${name} ${page.pageNumber} ${Math.round((page.view[3]! - Number(top)) * 100) / 100}`
      }))
    }
    finally {
      await task.destroy()
    }
  }
  /** Each run as "text size top", top from the page top. */
  const runsOf = (parsed: ParsedPdf) => parsed.pages.map(page => page.textRuns
    .filter(run => run.text.trim() !== '')
    .map(run => `${run.text} ${run.fontSize} ${Math.round((page.height - run.y) * 100) / 100}`))
  /** The numbers of the marks (7 pt) and of the notes (5.95 pt), per page. */
  const numbersOf = (parsed: ParsedPdf) => parsed.pages.map(page => ['7', '5.95'].map(size =>
    page.textRuns.filter(run => String(run.fontSize) === size && run.text.trim() !== '').map(run => run.text).join(' ')))

  // The link area of a mark is its glyphs, from their ascent to their
  // descent, as an inline box in CSS. In a text with a line height of 1.5,
  // a link area as high as the line height reached up from the glyphs'
  // bottom into the line above, over the first text's mark. The line puts
  // half its leading above each run (half-leading); the mark's leading box
  // (0.63 + 0.33 + 0.7 × 0.2 em) reaches highest, so the baseline is 11.03
  // below the line top at 31.63. Each row: top and bottom from the page top.
  it('keeps the link of a mark in a text with a line height off the line above', async () => {
    const { parsed } = await render({}, () => sheet(() => [
      h(PdfText, () => ['First', h(PdfFootnote, () => 'One.')]),
      h(PdfText, { style: { lineHeight: 1.5 } }, () => ['Second', h(PdfFootnote, () => 'Two.')]),
    ]))
    const page = parsed.pages[0]!
    // The marks' links, right of the words; the notes' numbers link back from x 20.
    const links = page.annotations.flatMap((item) => {
      const [left = 0, bottom = 0, , top = 0] = item.subtype === 'Link' ? item.rect ?? [] : []
      return left > 25 ? [[page.height - top, page.height - bottom].map(value => Math.round(value * 100) / 100)] : []
    })
    expect(links).toEqual([[20, 27.7], [33.03, 40.73]])
  })

  // A line with a raised mark is as high as the larger of its line height and
  // the mark's top plus the descent. With the default mark (70 %, raised a
  // third of the text size) and Helvetica (ascent 0.9, descent 0.2), that top
  // plus descent is 0.33 + 0.63 + 0.2 = 1.163 em at any size: a line height
  // of 1.15 grows the line, 1.17 does not. Each row: the first text's height
  // at 1.15 and 1.17, read from the baseline of the text below it.
  it('grows a line with a raised mark only below the mark\'s height, at any size', async () => {
    const heights = await Promise.all([9, 14].map(size => Promise.all([1.15, 1.17].map(async (lineHeight) => {
      const { parsed } = await render({}, () => sheet(() => [
        h(PdfText, { style: { fontSize: size, lineHeight } }, () => ['Line', h(PdfFootnote, () => 'Note.')]),
        h(PdfText, { style: { fontSize: size } }, () => 'Next'),
      ]))
      const page = parsed.pages[0]!
      const next = page.textRuns.find(run => run.text.trim() === 'Next')!
      return Math.round((page.height - next.y - 20 - 0.9 * size) * 100) / 100
    }))))
    expect(heights).toEqual([[10.47, 10.53], [16.29, 16.38]])
  })

  // Catches notes that do not print, print on another page than their mark,
  // lose their number, or miss the area and mark sizes; marks that do not
  // link to their note, and note numbers that do not link back to the top
  // of their mark.
  it('prints each note at the bottom of the page of its mark, after its number', async () => {
    const { parsed, bytes } = await render({}, () => sheet(() => [
      h(PdfText, () => ['Peat stores carbon', h(PdfFootnote, () => 'Source: the report.')]),
      // The second mark is on the second line of its paragraph.
      h(PdfText, () => ['Moss grows slowly in the cold, wet peat of the north, year after year', h(PdfFootnote, () => 'Second note.')]),
    ]))
    expect(runsOf(parsed)).toEqual([[
      'Peat stores carbon 10 29.63', '1 7 26.3',
      'Moss grows slowly in the cold, wet peat of the north, year 10 40.63', 'after year 10 52.27', '2 7 48.93',
      '1 5.95 165.58', 'Source: the report. 8.5 168.41', '2 5.95 175.47', 'Second note. 8.5 178.3',
    ]])
    expect(parsed.links).toEqual([
      { page: 1, destination: '__nuxtPdfFootnote-1' }, { page: 1, destination: '__nuxtPdfFootnote-2' },
      { page: 1, destination: '__nuxtPdfFootnote-1-ref' }, { page: 1, destination: '__nuxtPdfFootnote-2-ref' },
    ])
    expect(await destinationsOf(bytes, ['__nuxtPdfFootnote-1-ref', '__nuxtPdfFootnote-2-ref'])).toEqual([
      // The tops of the lines of the marks: the second paragraph starts at 31.63.
      '__nuxtPdfFootnote-1-ref 1 20', '__nuxtPdfFootnote-2-ref 1 42.63',
    ])
  })

  // Each row is a numbering that counts the wrong notes: through the
  // document every note counts, per page only the notes of the same page.
  it.each<[string, Record<string, unknown>, string[][]]>([
    ['through the document', {}, [['1 2', '1 2'], ['3', '3']]],
    ['per page', { footnotes: 'page' }, [['1 2', '1 2'], ['1', '1']]],
  ])('numbers footnotes %s', async (_name, documentProps, numbers) => {
    const { parsed } = await render(documentProps, () => [
      sheet(() => h(PdfText, () => ['A', h(PdfFootnote, () => 'One.'), ' B', h(PdfFootnote, () => 'Two.')])),
      sheet(() => h(PdfText, () => ['C', h(PdfFootnote, () => 'Three.')])),
    ])
    expect(numbersOf(parsed)).toEqual(numbers)
  })

  // The area spans the 260 pt content width. The default rule is its first
  // child: a third of that width (85.8 pt), 0.5 pt high (its top border), and
  // 4 pt above the first note. Catches a rule that is missing, not first, not
  // counted in the area's height, as wide as the page, or without the space
  // above the notes; and a rule that stays with `rule: false`.
  it.each<[string, Record<string, unknown>, Array<[string, number, number, number]>]>([
    ['the default rule', {}, [['VIEW', 0, 85.8, 0.5], ['TEXT', 4.5, 260, 9.89], ['TEXT', 14.39, 260, 9.89]]],
    ['a full-width rule', { rule: { width: '100%' } }, [['VIEW', 0, 260, 0.5], ['TEXT', 4.5, 260, 9.89], ['TEXT', 14.39, 260, 9.89]]],
    ['no rule', { rule: false }, [['TEXT', 0, 260, 9.89], ['TEXT', 9.89, 260, 9.89]]],
  ])('lays out the note area with %s', async (_name, footnoteStyles, children) => {
    const mounted = await mountPdfComponent(defineComponent(() => () => h(PdfDocument, { footnoteStyles }, () => sheet(() => [
      h(PdfText, () => ['Peat stores carbon', h(PdfFootnote, () => 'Source: the report.')]),
      h(PdfText, () => ['Moss', h(PdfFootnote, () => 'Second note.')]),
    ]))))
    try {
      const facts: PlainLayoutFacts = { destinations: {}, breaks: [] }
      const layout = await layoutPdfTree(toEngineDocument(mounted.document, facts).document, createPdfFontStore())
      const area = layout.children[0]!.children.at(-1) as LaidOutNode
      const round = (value: number) => Math.round(value * 100) / 100
      const height = children.at(-1)![1] + children.at(-1)![3]
      expect([area.type, round(area.box.top + area.box.height), area.box.left, area.box.width, round(area.box.height)]).toEqual(['VIEW', 180, 20, 260, round(height)])
      expect((area.children as LaidOutNode[]).map(child => [child.type, round(child.box.top), round(child.box.width), round(child.box.height)])).toEqual(children)
    }
    finally {
      mounted.unmount()
    }
  })

  // A footnote and a `wrap={false}` view higher than the page. The engine
  // shrinks the view to the page, so the diagnostics lay the document out
  // once more at natural heights to read the view's height; that layout has
  // no page size and so cannot hold notes. Catches a render that fails with
  // "cannot hold footnotes" after the PDF is done, and a diagnostics pass
  // that skips footnote documents and loses the warning.
  it('renders a page with a footnote and a block higher than the page, with the overflow warning', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { parsed, result } = await renderPdfTemplate(defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { size: 'A6' }, () => [
      h(PdfText, () => ['Body', h(PdfFootnote, () => 'Note.')]),
      h(PdfView, { wrap: false, style: { height: 600 } }, () => h(PdfText, () => 'Tall')),
    ]))), {})
    expect(result.diagnostics.layoutWarnings).toEqual([{ code: 'PDF_UNBREAKABLE_NODE_OVERFLOW', pageNumber: 2, nodeType: 'PdfView', nodeHeight: 600, availableHeight: 419.53 }])
    expect(parsed.pages.map(page => page.textRuns.map(run => run.text.trim()).filter(Boolean))).toEqual([['Body', '1', '1', 'Note.'], ['Tall']])
  })

  // The mark inside a `wrap={false}` view higher than the page: the view
  // stays on page 2, cut at the page end, and the engine shrinks it above
  // the notes. Catches notes placed below the view's natural end, off the
  // page, so the note is lost (its mark prints alone); the warning gives the
  // room above the notes.
  it('prints the note of a mark inside a block higher than the page on that page', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { parsed, result } = await renderPdfTemplate(defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { size: 'A6' }, () => [
      h(PdfText, () => 'Body'),
      h(PdfView, { wrap: false, style: { height: 600 } }, () => h(PdfText, () => ['Tall', h(PdfFootnote, () => 'Note.')])),
      h(PdfText, () => 'After'),
    ]))), {})
    expect(result.diagnostics.layoutWarnings).toEqual([{ code: 'PDF_UNBREAKABLE_NODE_OVERFLOW', pageNumber: 2, nodeType: 'PdfView', nodeHeight: 600, availableHeight: 389.23 }])
    expect(parsed.pages.map(page => page.textRuns.filter(run => run.text.trim()).map(run => `${run.text} ${Math.round(page.height - run.y)}`))).toEqual([
      ['Body 16'],
      ['Tall 17', '1 11', '1 411', 'Note. 416'],
      ['After 16'],
    ])
  })

  // A `wrap={false}` view whose bottom margin reaches into the note area:
  // the fit lets the margin cover the area's top, so the margin ends where
  // the page part's raised bottom padding starts. The view is not shrunk.
  // Catches a check that reads the room above the notes as the page's own
  // and lays the document out once more for nothing.
  it('does not take a block whose margin reaches into the note area for a shrunk one', async () => {
    const mounted = await mountPdfComponent(defineComponent(() => () => h(PdfDocument, null, () => sheet(() => [
      h(PdfText, () => ['Peat', h(PdfFootnote, () => 'Source.')]),
      h(PdfView, { wrap: false, style: { height: 100, marginBottom: 30 } }, () => h(PdfText, () => 'Block')),
    ]))))
    try {
      const facts: PlainLayoutFacts = { destinations: {}, breaks: [] }
      const layout = await layoutPdfTree(toEngineDocument(mounted.document, facts).document, createPdfFontStore())
      const page = layout.children[0] as LaidOutNode
      const [, block, area] = page.children as LaidOutNode[]
      const round = (value: number) => Math.round(value * 100) / 100
      // One page; the margin ends at the raised padding (161.63), 4 pt below
      // the area's top (its box at 165.61 less its 8 pt top margin).
      expect([layout.children.length, round(block!.box.top + block!.box.height + 30), round(page.box.height - page.box.paddingBottom), round(area!.box.top - 8)]).toEqual([1, 161.63, 161.63, 157.61])
      expect([...findShrinkCandidates(layout).keys]).toEqual([])
    }
    finally {
      mounted.unmount()
    }
  })

  // Rule 11 draws nothing below the page end: a text with wrap={false} of 8
  // lines, each with a mark, fits the page but not with its 8 notes, so the
  // page is forced at its end. The notes whose first line fits start there;
  // the others print first on page 2, before its own note, with the numbers
  // of their marks' page. Catches a forced page that keeps a line of every
  // note (below the page end), a note numbered by its own page (page 2 would
  // read 1, 2, 3, 4), a lost note, and a silent move.
  it('moves the notes that do not start on a forced page to the next page, numbered by their marks', async () => {
    const lines = Array.from({ length: 8 }, (_, index) => [index === 0 ? `Line ${index + 1}` : `\nLine ${index + 1}`, h(PdfFootnote, () => `Note ${index + 1}.`)]).flat()
    const { parsed, bytes, result } = await renderWithResult({ footnotes: 'page' }, () => sheet(() => [
      h(PdfText, { wrap: false }, () => lines),
      h(PdfText, () => ['After', h(PdfFootnote, () => 'Note 9.')]),
    ]))
    expect(numbersOf(parsed)).toEqual([['1 2 3 4 5 6 7 8', '1 2 3 4 5'], ['1', '6 7 8 1']])
    expect(parsed.pages.map(page => page.textRuns.filter(run => run.text.startsWith('Note ')).map(run => run.text).join(' '))).toEqual([
      'Note 1. Note 2. Note 3. Note 4. Note 5.',
      'Note 6. Note 7. Note 8. Note 9.',
    ])
    // The lowest baseline on each page, against the page end (200 less the 20 pt padding).
    expect(parsed.pages.map(page => Math.max(...page.textRuns.map(run => page.height - run.y)) <= 180)).toEqual([true, true])
    expect(result.diagnostics.layoutWarnings).toEqual([{ code: 'PDF_FOOTNOTES_MOVED', pageNumber: 1, footnotes: [6, 7, 8] }])
    // The number of note 6 links back to its mark on page 1; the mark links to the note on page 2.
    expect(await destinationsOf(bytes, ['__nuxtPdfFootnote-6-ref', '__nuxtPdfFootnote-6'])).toEqual(['__nuxtPdfFootnote-6-ref 1 78.17', '__nuxtPdfFootnote-6 2 140.45'])
    expect(result.diagnostics.passes).toBe(1)
  })

  // The warning names the moved notes by the numbers their marks print. The
  // forced page is page 2, whose marks are notes 2 to 9 of the document.
  // Catches numbers through the document in the warning ([7, 8, 9]).
  it('names the moved notes by the numbers of their marks', async () => {
    const lines = Array.from({ length: 8 }, (_, index) => [index === 0 ? `Line ${index + 1}` : `\nLine ${index + 1}`, h(PdfFootnote, () => `Note ${index + 2}.`)]).flat()
    const { parsed, result } = await renderWithResult({ footnotes: 'page' }, () => [
      sheet(() => h(PdfText, () => ['First', h(PdfFootnote, () => 'Note 1.')])),
      sheet(() => h(PdfText, { wrap: false }, () => lines)),
    ])
    expect(numbersOf(parsed).slice(1)).toEqual([['1 2 3 4 5 6 7 8', '1 2 3 4 5'], ['', '6 7 8']])
    expect(result.diagnostics.layoutWarnings).toEqual([{ code: 'PDF_FOOTNOTES_MOVED', pageNumber: 2, footnotes: [6, 7, 8] }])
  })

  // Only the page of the marks warns: page 2 carries notes 20 to 32 on to
  // page 3, but their marks are on page 1. Catches a warning for carried
  // notes (page 2 with [20, ..., 32] and page 1's numbers).
  it('warns once, on the page of the marks, for notes that move over two pages', async () => {
    const lines = Array.from({ length: 8 }, (_, line) => [line === 0 ? 'Line 1' : `\nLine ${line + 1}`, ...Array.from({ length: 4 }, (_, at) => h(PdfFootnote, () => `Note ${4 * line + at + 1}.`))]).flat()
    const { parsed, result } = await renderWithResult({ footnotes: 'page' }, () => sheet(() => h(PdfText, { wrap: false }, () => lines)))
    expect(parsed.pages.map(page => page.textRuns.filter(run => run.text.startsWith('Note ')).length)).toEqual([5, 14, 13])
    expect(result.diagnostics.layoutWarnings).toEqual([{ code: 'PDF_FOOTNOTES_MOVED', pageNumber: 1, footnotes: Array.from({ length: 27 }, (_, index) => index + 6) }])
  })

  // Per-page numbers read the page of each mark from the layout. One text
  // with 8 marks crosses three pages in a column container: catches a mark
  // that counts on the page where its text starts (page 2 would read 4 5 6 7).
  it('numbers the marks of a text that crosses a page in a column container by their own page', async () => {
    const words = Array.from({ length: 8 }, (_, index) => [`Word ${index + 1} `.repeat(14), h(PdfFootnote, () => `Note ${index + 1}.`)]).flat()
    const { parsed } = await render({ footnotes: 'page' }, () => sheet(() => h(PdfView, { style: { columnCount: 2, columnGap: 10, columnFill: 'auto' } }, () => h(PdfText, () => words))))
    expect(numbersOf(parsed)).toEqual([['1 2 3', '1 2 3'], ['1 2 3 4', '1 2 3 4'], ['1', '1']])
  })

  // Per page, the layout keeps the width of each number through the
  // document, so it needs no second pass: through the document the marks on
  // pages 2 to 4 are 7 to 24 (two digits from 10), per page they are 1 to 6.
  // Catches a layout that reads its own numbers back (a pass more) or moves
  // a page break with them.
  it('numbers per page in one pass when the numbers lose a digit', async () => {
    const { parsed, passes } = await render({ footnotes: 'page' }, () => sheet(() =>
      Array.from({ length: 24 }, (_, index) => h(PdfText, () => [`Line ${index + 1}`, h(PdfFootnote, () => `Note ${index + 1}.`)]))))
    // Six lines a page: the rule above the notes takes 4.5 pt of the room.
    const six = ['1 2 3 4 5 6', '1 2 3 4 5 6']
    expect(numbersOf(parsed)).toEqual([six, six, six, six])
    expect(parsed.pages.map(page => page.textRuns.filter(run => run.text.startsWith('Note ')).map(run => run.text).join(' '))).toEqual([
      'Note 1. Note 2. Note 3. Note 4. Note 5. Note 6.',
      'Note 7. Note 8. Note 9. Note 10. Note 11. Note 12.',
      'Note 13. Note 14. Note 15. Note 16. Note 17. Note 18.',
      'Note 19. Note 20. Note 21. Note 22. Note 23. Note 24.',
    ])
    expect(passes).toBe(1)
  })

  // The page walk numbers the marks of every text of a page in reading
  // order, table cells too. Catches a walk that skips a cell: its mark would
  // keep its reserved digit and the next mark would count one less.
  it('numbers a mark in a table cell with the marks of its page', async () => {
    const { parsed } = await render({ footnotes: 'page' }, () => [
      sheet(() => h(PdfText, () => ['Before', h(PdfFootnote, () => 'One.')])),
      sheet(() => [
        h(PdfTable, { columns: [1, 1] }, () => h(PdfTableRow, () => [
          h(PdfTableCell, () => h(PdfText, () => ['Peat', h(PdfFootnote, () => 'Two.')])),
          h(PdfTableCell, () => h(PdfText, () => ['Moss', h(PdfFootnote, () => 'Three.')])),
        ])),
        h(PdfText, () => ['After', h(PdfFootnote, () => 'Four.')]),
      ]),
    ])
    expect(numbersOf(parsed)).toEqual([['1', '1'], ['1 2 3', '1 2 3']])
  })

  const fontData = (file: string) => `data:font/ttf;base64,${readFileSync(resolve(file)).toString('base64')}` as PdfFontDataUrl
  const INTER = [{ family: 'Inter', src: fontData('test/fixtures/fonts/variable/InterVariable.ttf') }]
  const interSheet = (children: () => VNodeChild) => h(PdfPage, { size: [300, 200], style: { padding: 20, fontSize: 10, fontFamily: 'Inter' } }, children)

  // Inter's digits are proportional: 4 is the widest (1323 units), 0 is
  // 1292 and 1 is 833. A mark keeps the width of the widest digit, so every
  // number of its page fits. Catches a reserve in zeros: the fourth mark of
  // a page (4) is wider than its 0 and the render fails.
  it('numbers per page in a font with proportional digits', async () => {
    const { parsed, result } = await renderPreparedPdfTemplate(defineComponent(() => () => h(PdfDocument, { footnotes: 'page' }, () =>
      interSheet(() => h(PdfText, () => ['Peat', h(PdfFootnote, () => 'One.'), ' moss', h(PdfFootnote, () => 'Two.'), ' bog', h(PdfFootnote, () => 'Three.'), ' fen', h(PdfFootnote, () => 'Four.')])))), {}, { fonts: INTER })
    expect(numbersOf(parsed)).toEqual([['1 2 3 4', '1 2 3 4']])
    expect(result.diagnostics.passes).toBe(1)
  })

  // No fixture font moves two digits apart (kerning), so this row hands the
  // page walk the layout of numbers through the document in Inter: mark 5
  // (1215 units) is the fourth mark of page 2, and 4 is 1323 units.
  // Catches a number printed wider than the room its mark kept, past the
  // line's box, without an error.
  it('fails with the font\'s name when a number is wider than the room its mark kept', async () => {
    const mounted = await mountPdfComponent(defineComponent(() => () => h(PdfDocument, () => [
      interSheet(() => h(PdfText, () => ['First', h(PdfFootnote, () => 'One.')])),
      interSheet(() => h(PdfText, () => Array.from({ length: 10 }, (_, index) => [` w${index}`, h(PdfFootnote, () => `Note ${index + 2}.`)]).flat())),
    ])))
    try {
      const layout = await layoutPdfTree(toEngineDocument(mounted.document, { destinations: {}, breaks: [] }).document, createPdfFontStore(INTER))
      expect(() => numberFootnotesByPage(layout)).toThrow('The footnote number 4 is wider in the font InterVariable than the room its mark keeps for 1 digit: the font gives its digits different widths or moves them apart.')
    }
    finally {
      mounted.unmount()
    }
  })

  // A justified paragraph in Inter: each mark keeps the width of a 4 and
  // prints a narrower digit. Catches a relabelled justified line left short
  // by the width saved, and a last line justified (or moved) by it: the last
  // line stays left-aligned and narrower than its box.
  it('justifies a relabelled line again and leaves a relabelled last line left-aligned', async () => {
    const words = Array.from({ length: 30 }, (_, index) => `word${index}`)
    const mounted = await mountPdfComponent(defineComponent(() => () => h(PdfDocument, { footnotes: 'page' }, () =>
      interSheet(() => h(PdfText, { style: { textAlign: 'justify' } }, () => [...words.slice(0, 3), h(PdfFootnote, () => 'One.'), ` ${words.slice(3).join(' ')} end`, h(PdfFootnote, () => 'Two.')])))))
    try {
      const { layout } = await renderPlainDocument(mounted.document, { fontStore: createPdfFontStore(INTER) })
      const text = (layout.children[0]!.children as LaidOutNode[]).find(node => node.type === PDF_PRIMITIVES.Text)!
      const lines: Line[] = text.lines ?? []
      const marked = (line: Line) => line.runs.some(run => run.attributes.anchors?.some(anchor => anchor.id?.endsWith('-ref')))
      const round = (value: number) => Math.round(value * 100) / 100
      expect(lines.length).toBeGreaterThan(2)
      expect([marked(lines[0]!), marked(lines.at(-1)!)]).toEqual([true, true])
      expect(lines.slice(0, -1).map(line => Math.abs(textWidth(line) - line.box.width) < 0.01)).toEqual(lines.slice(0, -1).map(() => true))
      const last = lines.at(-1)!
      expect([last.isLast, last.spread, round(last.box.x), textWidth(last) < last.box.width - 5]).toEqual([true, 0, round(lines[0]!.box.x), true])
      expect(lines.map(line => line.string).join(' ')).toMatch(/word2 ?1 .*end ?2$/)
    }
    finally {
      mounted.unmount()
    }
  })

  // The one line of an Arabic text (Noto Sans Arabic, 18 pt, a 300 pt page
  // with 10 pt padding): each run as its glyphs' characters, its font size
  // and where it is painted (x from, x to), and each link rectangle (x from,
  // x to). The runs follow the visual order (reorder.ts).
  const rightToLeftLine = async (children: () => VNodeChild[], documentProps: Record<string, unknown> = {}) => {
    const fontStore = createPdfFontStore([{ family: 'Noto Arabic', src: fontData('test/fixtures/fonts/international/NotoSansArabic-Subset.ttf') }])
    const mounted = await mountPdfComponent(defineComponent(() => () => h(PdfDocument, { language: 'ar', ...documentProps }, () =>
      h(PdfPage, { size: [300, 200], style: { padding: 10 } }, () => h(PdfText, { style: { fontFamily: 'Noto Arabic', fontSize: 18 } }, children)))))
    try {
      const { bytes, layout } = await renderPlainDocument(mounted.document, { fontStore })
      const text = (layout.children[0]!.children as LaidOutNode[]).find(node => node.type === PDF_PRIMITIVES.Text)!
      const line = text.lines![0]!
      const round = (value: number) => Math.round(value * 100) / 100
      let x = text.box!.left + line.box.x - (text.alignOffset ?? 0)
      const runs = line.runs.map((run) => {
        const from = x
        x += run.xAdvance ?? 0
        return [String.fromCodePoint(...run.glyphs.flatMap(glyph => glyph.codePoints)), run.attributes.fontSize, round(from), round(x)]
      })
      const links = (await parsePdf(bytes)).pages[0]!.annotations.filter(annotation => annotation.subtype === 'Link').map(annotation => [round(annotation.rect![0]!), round(annotation.rect![2]!)])
      return { runs, links }
    }
    finally {
      mounted.unmount()
    }
  }

  // "علم عمل حرم", a mark numbered per page, " مال": in visual order " مال"
  // reversed, the mark, then the first words reversed. Catches runs that keep
  // their places in the string while holding the glyphs of the visual order:
  // the mark's reserved digit (0) was drawn at 18 pt inside the Arabic run,
  // and the relabelled 1 with its link area at 102.83 pt, among the letters
  // of the first word. The second link is the note's number, which links
  // back to the mark.
  it('numbers a mark per page in a line with right-to-left text, its own glyph under its link', async () => {
    expect(await rightToLeftLine(() => ['علم عمل حرم', h(PdfFootnote, () => 'Note'), ' مال'], { footnotes: 'page' })).toEqual({
      runs: [['لام ', 18, 10, 41.88], ['1', 12.6, 41.88, 49.09], ['مرح لمع ملع', 18, 49.09, 141.34]],
      links: [[41.88, 49.09], [10, 15.96]],
    })
  })

  // "علم عمل ", a link around "حرم", " مال": the link's run holds its word
  // (drawn "مرح", after " مال" reversed) and its area covers it. The runs
  // beside the link differ in length (8 and 4 characters), so a run filled
  // with the glyphs at its place in the string holds other letters. Catches
  // the link run drawing "ح" and the end of " مال", with its area there.
  it('keeps a link in a line with right-to-left text over its own word', async () => {
    expect(await rightToLeftLine(() => ['علم عمل ', h(PdfLink, { href: 'https://example.com' }, () => 'حرم'), ' مال'])).toEqual({
      runs: [['لام ', 18, 10, 41.88], ['مرح', 18, 41.88, 67.6], [' لمع ملع', 18, 67.6, 134.13]],
      links: [[41.88, 67.6]],
    })
  })
})
