import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { transform } from 'esbuild'
import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { parseRichTextMarkdown, validateRichText } from '../src/runtime/rich-text'
import { assertRichText } from '../src/runtime/rich-text/validate'
import type { PdfRichBlock } from '../src/runtime/rich-text/types'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import { PDF_SOURCE_PROP } from '../src/runtime/shared/template'
import { installPdfCanvasGlobals, parsePdf, type ParsedPdf } from '../src/test/pdf'

installPdfCanvasGlobals()

const { PdfDocument, PdfPage, PdfRichText, PdfText, PdfView } = PDF_COMPONENTS

// A4 with 40 pt padding: content box 515.28 × 761.89 pt.
const PAGE = { size: 'A4', style: { padding: 40, fontSize: 10 } } as const

const doc = (content: () => VNode[]) => defineComponent(() => () =>
  h(PdfDocument, { creationDate: new Date(0) }, () => h(PdfPage, PAGE, content)))

const render = async (content: () => VNode[]): Promise<ParsedPdf> => {
  const mounted = await mountPdfComponent(doc(content))
  try {
    return await parsePdf((await renderPlainDocument(mounted.document)).bytes)
  }
  finally {
    mounted.unmount()
  }
}

/** Every word of the document in reading order, with its page. */
const wordsOf = (parsed: ParsedPdf): Array<{ page: number, word: string }> => parsed.pages.flatMap(page =>
  page.text.split(/\s+/).filter(Boolean).map(word => ({ page: page.number, word })))

const runOf = (parsed: ParsedPdf, text: string) => {
  const run = parsed.pages.flatMap(page => page.textRuns).find(item => item.text === text)
  if (run === undefined) throw new Error(`no text run "${text}"`)
  return run
}

describe('PdfRichText', () => {
  // Catches a block type, mark or link that renders nothing, renders twice or out of order.
  it('prints every block of the HTML in order, with links on their text', async () => {
    const html = [
      '<h2>Alpha heading</h2>',
      '<p>Bravo <strong>charlie</strong> <em>delta</em> <u>echo</u> <s>foxtrot</s> <code>golf</code> and <a href="https://example.test/hotel">hotel link</a>.<br>India</p>',
      '<ul><li>Juliet</li><li>Kilo<ol start="7"><li>Lima</li><li>Mike</li></ol></li></ul>',
      '<blockquote><p>November</p></blockquote>',
      '<pre>  oscar\n    papa</pre>',
      '<hr>',
      '<p>Quebec</p>',
    ].join('')
    // An italic link is its own text run, so its position can be read back.
    const parsed = await render(() => [h(PdfRichText, { html, styles: { link: { fontStyle: 'italic' } } })])

    expect(parsed.pages[0]!.text.replace(/\s+/g, ' ').trim()).toBe(
      'Alpha heading Bravo charlie delta echo foxtrot golf and hotel link. India • Juliet • Kilo 7. Lima 8. Mike November oscar papa Quebec',
    )
    expect(parsed.links).toEqual([{ page: 1, url: 'https://example.test/hotel' }])
    // The link area covers its text.
    const [annotation] = parsed.pages[0]!.annotations.filter(item => item.subtype === 'Link')
    const [x1, y1, x2, y2] = annotation!.rect!
    const word = runOf(parsed, 'hotel link')
    expect(x1).toBeLessThanOrEqual(word.x + 0.5)
    expect(x2).toBeGreaterThanOrEqual(word.x + word.width - 0.5)
    expect(y1).toBeLessThanOrEqual(word.y + 0.5)
    expect(y2).toBeGreaterThanOrEqual(word.y + word.height - 1)
    // A code block keeps its indentation: "papa" starts two spaces (2 × 2.78 pt
    // in Helvetica 10) right of "oscar".
    expect(runOf(parsed, 'papa').x - runOf(parsed, 'oscar').x).toBeCloseTo(5.56, 0)
  })

  // Catches marks that do not reach the text (bold, italic, font size of a heading).
  it('sets heading sizes from the font size of its own style, and bold and italic faces', async () => {
    const parsed = await render(() => [h(PdfRichText, {
      style: { fontSize: 9 },
      html: '<h1>Uno</h1><h3>Tres</h3><p>Plain <strong>Bold</strong> <em>Slanted</em></p>',
    })])

    expect(runOf(parsed, 'Uno').fontSize).toBeCloseTo(18, 1)
    expect(runOf(parsed, 'Tres').fontSize).toBeCloseTo(12.15, 1)
    expect(runOf(parsed, 'Plain').fontSize).toBeCloseTo(9, 1)
    expect(runOf(parsed, 'Bold').fontName).not.toBe(runOf(parsed, 'Plain').fontName)
    expect(runOf(parsed, 'Slanted').fontName).not.toBe(runOf(parsed, 'Plain').fontName)
  })

  // Catches defaults that stay points of 12 pt instead of following the body
  // size the rich text inherits (an h4 larger than 9 pt body text, 7.2 pt
  // margins), and, at 12 pt, any move of today's sizes. Each run is
  // [text, font size, top].
  it.each<[number, Array<[string, number, number]>]>([
    [9, [['Intro', 9, 48.1], ['Uno', 18, 81.85], ['Body', 9, 100.3], ['Cuatro', 10.35, 126.59], ['End', 9, 142.94]]],
    // The same numbers as before the defaults followed the body size, but
    // the headings' line height of 1.25 now puts half of what it adds above
    // their glyphs (half-leading): 'Uno' 1.8 and 'Cuatro' 1.04 lower.
    [12, [['Intro', 12, 50.8], ['Uno', 24, 95.8], ['Body', 12, 120.4], ['Cuatro', 13.8, 155.46], ['End', 12, 177.25]]],
  ])('sizes and spaces headings by the inherited body size of %d pt', async (body, runs) => {
    const parsed = await render(() => [h(PdfView, { style: { fontSize: body } }, () => h(PdfRichText, {
      html: '<p>Intro</p><h1>Uno</h1><p>Body</p><h4>Cuatro</h4><p>End</p>',
    }))])
    const page = parsed.pages[0]!
    const round = (value: number) => Math.round(value * 100) / 100
    expect(page.textRuns.filter(run => run.text !== '').map(run => [run.text, round(run.fontSize), round(page.height - run.y)])).toEqual(runs)
  })

  // Catches a heading that sits on the text below it (the gallery article showed
  // it: the body's line height of 1.45 reached the heading as 1.45 × the body
  // size, a line box shorter than the heading) or that keeps its top margin as
  // the first block.
  it('gives a heading its own line height, 1 × the font size above and 0.6 × below, none above as the first block', async () => {
    const mounted = await mountPdfComponent(doc(() => [h(PdfRichText, {
      style: { fontSize: 10, lineHeight: 1.45 },
      html: '<h2>First</h2><p>Intro</p><h2>Second</h2><p>Body</p>',
    })]))
    try {
      const { layout } = await renderPlainDocument(mounted.document)
      const boxes: Array<[number, number, number]> = []
      const visit = (node: unknown): void => {
        if (typeof node !== 'object' || node === null) return
        if ('type' in node && node.type === 'TEXT' && 'box' in node && typeof node.box === 'object' && node.box !== null
          && 'marginTop' in node.box && 'marginBottom' in node.box && 'height' in node.box) {
          const round = (value: unknown) => Math.round(Number(value) * 100) / 100
          boxes.push([round(node.box.height), round(node.box.marginTop), round(node.box.marginBottom)])
        }
        if ('children' in node && Array.isArray(node.children)) node.children.forEach(visit)
      }
      visit(layout.children[0])
      // [line box height, margin above, margin below]; the heading is 16 pt.
      expect(boxes).toEqual([[20, 0, 6], [14.5, 0, 6], [20, 10, 6], [14.5, 0, 0]])
    }
    finally {
      mounted.unmount()
    }
  })

  // Catches a run that keeps its verticalAlign in the model but prints on the
  // baseline: the shifts are N1's, a third of the font size up and a fifth down.
  // Catches a sup or sub at full size, a size taken of the wrong text, and a
  // `sup` style of the author that replaces the default or is ignored.
  it.each<[string, Record<string, unknown>, Array<[number, number]>]>([
    ['at 70 % of the text around them', {}, [[21, 10], [21, -6]]],
    ['in the sup and sub styles of the author', { sup: { color: '#aa0000' }, sub: { fontSize: '50%' } }, [[21, 10], [15, -6]]],
  ])('raises sup and lowers sub %s', async (_name, styles, expected) => {
    const parsed = await render(() => [h(PdfRichText, { style: { fontSize: 30 }, styles, html: '<p>area m<sup>2</sup> gas CO<sub><b>4</b></sub></p>' })])
    const base = runOf(parsed, 'area m')
    // The shift is a third or a fifth of the text around the run; the bold `4` is its own text run.
    expect([runOf(parsed, '2'), runOf(parsed, '4')].map(run => [run.fontSize, Math.round((run.y - base.y) * 100) / 100])).toEqual(expected)
  })

  // Catches a `styles` entry that is ignored or replaces the defaults instead of merging.
  it('merges the styles of an element over the defaults', async () => {
    const parsed = await render(() => [h(PdfRichText, {
      html: '<h2>Head</h2><p>Body</p>',
      styles: { h2: { fontSize: 30 }, p: { fontSize: 7 } },
    })])

    expect(runOf(parsed, 'Head').fontSize).toBeCloseTo(30, 1)
    // Still bold: the default fontWeight stays under the override.
    expect(runOf(parsed, 'Head').fontName).not.toBe(runOf(parsed, 'Body').fontName)
    expect(runOf(parsed, 'Body').fontSize).toBeCloseTo(7, 1)
  })

  // Catches headings missing from the outline, or entries without bookmarks: true.
  it('writes headings as outline entries only with bookmarks', async () => {
    const html = '<h1>First part</h1><p>a</p><h2>Second <em>part</em></h2><p>b</p>'
    expect((await render(() => [h(PdfRichText, { html, bookmarks: true })])).outline.map(item => item.title)).toEqual(['First part', 'Second part'])
    expect((await render(() => [h(PdfRichText, { html })])).outline).toEqual([])
  })

  // Catches markers that do not line up: a marker column that grows with the
  // number, so bodies start at different x.
  it('aligns list numbers 1 to 120 at the right and their texts at one x', async () => {
    const items = Array.from({ length: 120 }, (_, index) => `<li>item${index + 1}</li>`).join('')
    // Bold markers are their own text runs, so marker and body positions can be read back.
    const parsed = await render(() => [h(PdfRichText, { html: `<ol>${items}</ol>`, styles: { marker: { fontWeight: 'bold' } } })])

    const markers = Array.from({ length: 120 }, (_, index) => runOf(parsed, `${index + 1}.`))
    const bodies = Array.from({ length: 120 }, (_, index) => runOf(parsed, `item${index + 1}`))
    const rightEdges = markers.map(run => run.x + run.width)
    expect(Math.max(...rightEdges) - Math.min(...rightEdges)).toBeLessThan(0.5)
    expect(new Set(bodies.map(run => run.x.toFixed(1)))).toHaveLength(1)
    expect(bodies[0]!.x).toBeGreaterThan(Math.max(...rightEdges))
    expect(parsed.pageCount).toBe(3)
  })

  // Catches nesting that loses its indent or its markers.
  it('indents a list nested three deep, with a bullet and then dashes', async () => {
    const parsed = await render(() => [h(PdfRichText, { html: '<ul><li>one<ul><li>two<ul><li>three</li></ul></li></ul></li></ul>', styles: { marker: { fontWeight: 'bold' } } })])

    expect(parsed.pages[0]!.text.replace(/\s+/g, ' ').trim()).toBe('• one - two - three')
    const [one, two, three] = ['one', 'two', 'three'].map(text => runOf(parsed, text).x)
    expect(two).toBeGreaterThan(one! + 10)
    expect(three).toBeGreaterThan(two! + 10)
  })

  // Catches a word lost or printed twice at a page break, and paragraphs,
  // list items or quotes that do not split across pages.
  it('splits a six-page article with no lost or doubled word', async () => {
    let counter = 0
    const words = (prefix: string, count: number) => Array.from({ length: count }, () => `${prefix}${String(counter++).padStart(4, '0')}`)
    const blocks: PdfRichBlock[] = []
    const expected: string[] = []
    const paragraph = (prefix: string, count: number): PdfRichBlock => {
      const list = words(prefix, count)
      expected.push(...list)
      return { type: 'paragraph', children: [{ type: 'text', text: list.join(' ') }] }
    }
    for (let section = 0; section < 14; section += 1) {
      const heading = words('h', 2)
      expected.push(...heading)
      blocks.push({ type: 'heading', level: 2, children: [{ type: 'text', text: heading.join(' ') }] })
      // Sizes vary per section, so page breaks fall inside different blocks.
      blocks.push(paragraph('p', 60 + (section * 37) % 120))
      blocks.push({ type: 'list', ordered: section % 2 === 0, items: [[paragraph('l', 90 + (section * 53) % 110)], [paragraph('l', 30)]] })
      blocks.push({ type: 'quote', children: [paragraph('q', 140 + (section * 29) % 110)] })
    }
    const parsed = await render(() => [h(PdfRichText, { content: blocks })])
    const printed = wordsOf(parsed).filter(({ word }) => /^[hplq]\d{4}$/.test(word))

    expect(parsed.pageCount).toBeGreaterThanOrEqual(6)
    expect(printed.map(({ word }) => word)).toEqual(expected)
    // Some list item and some quote run over a page break.
    const splitKinds = new Set<string>()
    for (let index = 1; index < printed.length; index += 1) {
      const [before, after] = [printed[index - 1]!, printed[index]!]
      if (before.page !== after.page && before.word[0] === after.word[0]) splitKinds.add(before.word[0]!)
    }
    expect(splitKinds).toContain('l')
    expect(splitKinds).toContain('q')
  })

  // Catches a heading left alone at the end of a page. Without minPresenceAhead
  // the heading fits on page 1 and its paragraph does not.
  it('moves a heading near the page end to the next page with its paragraph', async () => {
    const parsed = await render(() => [
      h(PdfView, { style: { height: 700 } }),
      h(PdfRichText, { html: '<p>Closing words.</p><h2>Lonely heading</h2><p>First line of the section that follows the heading.</p>' }),
    ])

    expect(parsed.pageCount).toBe(2)
    expect(parsed.pages[0]!.text).toContain('Closing words.')
    expect(parsed.pages[1]!.text).toContain('Lonely heading')
    expect(parsed.pages[1]!.text).toContain('First line')
  })

  // Catches a heading kept with a room of 3 × 12 pt, guessed when the body
  // size is inherited: at 24 pt one line of the paragraph is 26.4 pt, so the
  // heading stayed alone at the page end above the room for a single line.
  it('keeps a heading with its paragraph at an inherited body size of 24 pt', async () => {
    const mounted = await mountPdfComponent(defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { size: 'A4', style: { padding: 40 } }, () => [
      h(PdfView, { style: { height: 588 } }),
      h(PdfView, { style: { fontSize: 24 } }, () => h(PdfRichText, { html: '<p>Closing words.</p><h2>Lonely heading</h2><p>First line of the section that follows the heading, long enough to need two lines.</p>' })),
    ]))))
    try {
      const parsed = await parsePdf((await renderPlainDocument(mounted.document)).bytes)
      expect(parsed.pages.map(page => ['Closing', 'Lonely', 'First line'].filter(word => page.text.includes(word)))).toEqual([['Closing'], ['Lonely', 'First line']])
    }
    finally {
      mounted.unmount()
    }
  })
})

describe('PdfRichText input errors', () => {
  const failure = (props: Record<string, unknown>) => mountPdfComponent(doc(() => [h(PdfRichText, { [PDF_SOURCE_PROP]: 'pdfs/article.vue:4:5', ...props })]))

  // Catches a silent empty render when the author passes no input or two.
  it.each([
    ['no input', {}],
    ['two inputs', { html: '<p>a</p>', content: [] }],
  ])('fails with %s', async (_name, props) => {
    await expect(failure(props)).rejects.toMatchObject({
      code: PDF_ERROR_CODES.TreeInvalid,
      message: '<PdfRichText> takes exactly one of "html", "content" and "comark".',
      source: { file: 'pdfs/article.vue', line: 4, column: 5 },
    })
  })

  // Catches a misspelt style key that silently does nothing.
  it('fails on an unknown styles key', async () => {
    await expect(failure({ html: '<p>a</p>', styles: { paragraph: { color: 'red' } } })).rejects.toMatchObject({
      code: PDF_ERROR_CODES.TreeInvalid,
      message: '<PdfRichText> "styles" has no element "paragraph". Use p, h1, h2, h3, h4, h5, h6, list, listItem, marker, quote, code, codeBlock, link, strong, em, sup, sub, rule, image, caption, imagePlaceholder, table, tableHeader, tableRow, tableCell, tableHeaderCell.',
    })
  })

  // Catches untrusted input over a limit reaching the layout.
  it('fails on HTML over a limit with the source position', async () => {
    await expect(failure({ html: '<i>'.repeat(40) })).rejects.toMatchObject({
      code: PDF_ERROR_CODES.RichTextInvalid,
      issues: [{ rule: 'PDF-RICH-LIMIT', path: 'html', message: 'the HTML nests elements 33 deep, over the limit of 32' }],
      source: { file: 'pdfs/article.vue', line: 4, column: 5 },
    })
  })

  // Catches a wrong model reaching the layout, and a message without the path.
  it('fails on a wrong content model, naming each path', async () => {
    await expect(failure({ content: [{ type: 'paragraph', children: [{ type: 'link', href: 'javascript:alert(1)', children: [] }] }] })).rejects.toMatchObject({
      code: PDF_ERROR_CODES.RichTextInvalid,
      message: 'Rich text input is invalid: content[0].children[0].href: expected an absolute http:, https:, mailto: or tel: URL, found "javascript:alert(1)".',
    })
  })
})

describe('PdfRichText with Markdown and comark components', () => {
  const html = '<h2>Seed swap</h2><p>Bring <strong>labelled</strong> seeds and read the <a href="https://example.test/rules">rules</a>.</p><ol start="2"><li>Sort by family</li><li>Count</li></ol><blockquote><p>Share the surplus.</p></blockquote><pre><code>beans: 40</code></pre>'
  const markdown = '## Seed swap\n\nBring **labelled** seeds and read the [rules](https://example.test/rules).\n\n2. Sort by family\n3. Count\n\n> Share the surplus.\n\n```\nbeans: 40\n```\n'
  const textOf = (parsed: ParsedPdf) => parsed.pages.map(page => page.text).join(' ').replace(/\s+/g, ' ').trim()

  // Catches an input path that maps one construct differently from the other.
  it('prints the same article from HTML and from Markdown', async () => {
    const fromHtml = await render(() => [h(PdfRichText, { html })])
    const content = await parseRichTextMarkdown(markdown)
    const fromMarkdown = await render(() => [h(PdfRichText, { content })])

    expect(textOf(fromMarkdown)).toBe('Seed swap Bring labelled seeds and read the rules. 2. Sort by family 3. Count Share the surplus. beans: 40')
    expect(textOf(fromMarkdown)).toBe(textOf(fromHtml))
    expect(fromMarkdown.links).toEqual(fromHtml.links)
  })

  const Alert = defineComponent({
    props: { type: { type: String, required: true }, level: { type: Number, required: true } },
    setup: (props, { slots }) => () => h(PdfView, { style: { borderLeftWidth: 3, paddingLeft: 6 } }, () => [
      h(PdfText, null, () => `${props.type.toUpperCase()} ${props.level}`),
      slots.default?.(),
    ]),
  })
  const Card = defineComponent({
    setup: (_props, { slots }) => () => h(PdfView, null, () => [h(PdfText, null, () => 'CARD'), slots.title?.(), slots.default?.()]),
  })

  // Catches a mapped component that loses its props, its content or a named
  // slot, and an unmapped one that loses its content.
  it('renders a mapped component around its content and keeps the content of an unmapped one', async () => {
    const content = await parseRichTextMarkdown('::alert{type="info" :level="2"}\nInside **text**\n::\n\n::card\n#title\nHeading\n#default\nBody\n::\n\n::constructor\nKept\n::\n\nAfter')
    const parsed = await render(() => [h(PdfRichText, { content, components: { alert: Alert, card: Card } })])
    expect(textOf(parsed)).toBe('INFO 2 Inside text CARD Heading Body Kept After')

    const unmapped = await render(() => [h(PdfRichText, { content })])
    expect(textOf(unmapped)).toBe('Inside text Heading Body Kept After')
  })

  // Catches props from the content that reach a component unfiltered: an
  // undeclared name falls through to the root primitive and fails the render,
  // `onClick`, `ref` and `key` reach Vue itself. A declared kebab-case name
  // must still arrive in camelCase.
  it('passes a mapped component only the props it declares', async () => {
    const received: Array<{ props: Record<string, unknown>, attrs: Record<string, unknown> }> = []
    const Note = defineComponent({
      props: { tone: String, maxWidth: String },
      setup: (props, { attrs, slots }) => {
        received.push({ props: { ...props }, attrs: { ...attrs } })
        return () => h(PdfView, null, () => [h(PdfText, null, () => `${props.tone} ${props.maxWidth}`), slots.default?.()])
      },
    })
    const Badge = (props: { label?: string }) => h(PdfText, null, () => `[${props.label}]`)
    Badge.props = ['label']
    const content = await parseRichTextMarkdown([
      '::note{tone="tip" max-width="120" onClick="x" ref="y" key="z" innerHTML="<b>" v-html="q" toen="typo"}',
      'Inside',
      '::',
      '',
      '::badge{label="new" extra="1"}',
      '::',
      '',
      '::plain{onClick="x" foo="1"}',
      'Plain',
      '::',
    ].join('\n'))
    const Plain = defineComponent({ setup: (_props, { attrs, slots }) => {
      received.push({ props: {}, attrs: { ...attrs } })
      return () => h(PdfView, null, () => slots.default?.())
    } })
    const parsed = await render(() => [h(PdfRichText, { content, components: { note: Note, badge: Badge, plain: Plain } })])

    expect(textOf(parsed)).toBe('tip 120 Inside [new] Plain')
    expect(received).toEqual([
      { props: { tone: 'tip', maxWidth: '120' }, attrs: {} },
      { props: {}, attrs: {} },
    ])
  })

  // Catches a name of the prototype that finds a function on a plain object
  // instead of falling back to the content.
  it('keeps the content of components named after Object.prototype', async () => {
    const parsed = await render(() => [h(PdfRichText, {
      comark: { nodes: [['constructor', {}, 'one'], ['toString', {}, 'two'], ['__proto__', {}, 'three'], ['hasOwnProperty', {}, 'four']] },
      components: { alert: Alert },
    })])
    expect(textOf(parsed)).toBe('one two three four')
  })

  // Catches the comark prop skipping the shape check or the source position.
  it('fails on a wrong comark tree with the path and the source position', async () => {
    await expect(mountPdfComponent(doc(() => [h(PdfRichText, { [PDF_SOURCE_PROP]: 'pdfs/post.vue:7:3', comark: [['p', 'x']] })]))).rejects.toMatchObject({
      code: PDF_ERROR_CODES.RichTextInvalid,
      issues: [{ rule: 'PDF-RICH-NODE', path: 'comark[0][1]', message: 'expected a props object, found "x"' }],
      source: { file: 'pdfs/post.vue', line: 7, column: 3 },
    })
  })

  // Catches the common mistake of passing the unawaited parse, which would
  // otherwise read as "expected an array, found an object".
  it.each<[string, Record<string, unknown>, string]>([
    ['a Promise as content', { content: parseRichTextMarkdown('a') }, '<PdfRichText> got a Promise. Await parseRichTextMarkdown() where the data is loaded and pass the result to "content".'],
    ['components that are not an object', { html: '<p>a</p>', components: 'Alert' }, '<PdfRichText> "components" must be an object of Vue components by name, found "Alert".'],
    ['a component that is not a component', { html: '<p>a</p>', components: { alert: 'Alert' } }, '<PdfRichText> "components.alert" must be a Vue component, found "Alert".'],
  ])('fails on %s', async (_name, props, message) => {
    await expect(mountPdfComponent(doc(() => [h(PdfRichText, { ...props })]))).rejects.toMatchObject({ code: PDF_ERROR_CODES.TreeInvalid, message })
  })

  // Catches a component block in a hand-written model whose props or slots
  // are not plain JSON or carry a name that changes the prototype.
  it.each<[string, unknown, Array<[string, string]>]>([
    ['a valid component', [{ type: 'component', name: 'alert', props: { type: 'info', n: 2, tags: ['a', null], deep: { ok: true } }, children: [], slots: { title: [{ type: 'rule' }] } }], []],
    ['an empty name', [{ type: 'component', name: '', props: {}, children: [] }], [['content[0].name', 'expected a name of 1 to 64 characters, found ""']]],
    ['props that are not an object', [{ type: 'component', name: 'a', props: [1], children: [] }], [['content[0].props', 'expected a plain object, found an array']]],
    ['a prop that is a Date', [{ type: 'component', name: 'a', props: { when: new Date(0) }, children: [] }], [['content[0].props.when', 'expected a JSON value (string, number, boolean, null, array or object), found a Date']]],
    ['a prop that is not finite', [{ type: 'component', name: 'a', props: { n: Number.POSITIVE_INFINITY }, children: [] }], [['content[0].props.n', 'expected a finite number, found Infinity']]],
    ['a __proto__ prop', [{ type: 'component', name: 'a', props: JSON.parse('{"__proto__":{"x":1}}'), children: [] }], [['content[0].props.__proto__', 'expected a name of letters, digits, "_" and "-", found "__proto__"']]],
    ['a slot that is not a block list', [{ type: 'component', name: 'a', props: {}, children: [], slots: { title: 'T' } }], [['content[0].slots.title', 'expected an array, found "T"']]],
    ['a code language that is not text', [{ type: 'code', text: 'x', language: 7 }], [['content[0].language', 'expected a string, found 7']]],
    // The shared link check (shared/link-target.ts) must keep refusing a file: URI.
    ['a file: link', [{ type: 'paragraph', children: [{ type: 'link', href: 'file:///etc/passwd', children: [] }] }], [['content[0].children[0].href', 'expected an absolute http:, https:, mailto: or tel: URL, found "file:///etc/passwd"']]],
  ])('validates %s', (_name, content, expected) => {
    expect(validateRichText(content).map(issue => [issue.path, issue.message])).toEqual(expected)
  })
})

describe('PdfRichText tables', () => {
  // A4, 40 pt padding: the content box runs from x 40 to 555.28.
  const RIGHT = 555.28
  const renderWithWarnings = async (content: () => VNode[]) => {
    const mounted = await mountPdfComponent(doc(content))
    try {
      const result = await renderPlainDocument(mounted.document)
      return { parsed: await parsePdf(result.bytes), warnings: result.layoutWarnings }
    }
    finally {
      mounted.unmount()
    }
  }
  const runsOf = (parsed: ParsedPdf) => parsed.pages.flatMap(page => page.textRuns.filter(run => run.text.trim() !== '').map(run => ({ ...run, page: page.number })))

  // Catches a header printed once (or flattened into paragraphs, as before
  // C5), from Markdown through comark to the PDF.
  it('repeats the header row of a Markdown table at the top of the next page', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => `| Row ${index + 1} | ${index * 3} |`).join('\n')
    const content = await parseRichTextMarkdown(`| Site | t/ha |\n| - | -: |\n${rows}\n`)
    const { parsed } = await renderWithWarnings(() => [h(PdfRichText, { content })])
    const runs = runsOf(parsed)
    const pages = (text: string) => runs.filter(run => run.text === text).map(run => run.page)
    expect(parsed.pages.length).toBe(2)
    expect(pages('Site')).toEqual([1, 2])
    expect(pages('Row 60')).toEqual([2])
    // On page 2 the header is the first line, above the first row that continues.
    const second = runs.filter(run => run.page === 2)
    expect(second[0]!.text).toBe('Site')
  })

  // Catches a table wider than the page: 'auto' columns of long sentences
  // must get narrower together and wrap inside their cells.
  it('keeps a wide table of six \'auto\' columns inside the content width, wrapping in its cells', async () => {
    const sentence = 'Peatlands store more carbon than all the forests of the world together'
    const cells = (tag: string) => Array.from({ length: 6 }, (_, index) => `<${tag}>${index + 1} ${sentence}</${tag}>`).join('')
    const { parsed, warnings } = await renderWithWarnings(() => [h(PdfRichText, { html: `<table><thead><tr>${cells('th')}</tr></thead><tr>${cells('td')}</tr></table>` })])
    const runs = runsOf(parsed)
    expect(warnings).toEqual([])
    expect(Math.min(...runs.map(run => run.x))).toBeGreaterThanOrEqual(40)
    expect(Math.max(...runs.map(run => run.x + run.width))).toBeLessThanOrEqual(RIGHT + 0.01)
    // Each cell wraps: its 12 words take several lines.
    const lines = new Set(runs.filter(run => run.x < 120).map(run => run.y))
    expect(lines.size).toBeGreaterThan(6)
  })

  // Catches a header made up for a table without thead: its first row prints
  // once, so a table of only rows has no repeated row.
  it('prints a table of rows only without a header on the next page', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => `<tr><td>Row ${index + 1}</td><td>${index}</td></tr>`).join('')
    const { parsed } = await renderWithWarnings(() => [h(PdfRichText, { html: `<table>${rows}</table>` })])
    const runs = runsOf(parsed)
    expect(parsed.pages.length).toBe(2)
    expect(runs.filter(run => run.text === 'Row 1').map(run => run.page)).toEqual([1])
    expect(runs.find(run => run.page === 2)?.text).not.toBe('Row 1')
  })

  // Catches a long CMS cell that is cut at the page end with
  // PDF_UNBREAKABLE_NODE_OVERFLOW instead of going on on the next page.
  it('splits a body row that is longer than the page', async () => {
    const long = Array.from({ length: 2500 }, (_, index) => `w${index}`).join(' ')
    const { parsed, warnings } = await renderWithWarnings(() => [h(PdfRichText, { html: `<table><thead><tr><th>Note</th></tr></thead><tr><td>${long}</td></tr></table>` })])
    const words = wordsOf(parsed)
    expect(warnings).toEqual([])
    expect(words.find(item => item.word === 'w0')?.page).toBe(1)
    expect(parsed.pages.length).toBe(3)
    expect(words.find(item => item.word === 'w2499')?.page).toBe(3)
    expect(words.filter(item => item.word === 'Note').map(item => item.page)).toEqual([1, 2, 3])
  })

  // Catches a footnote in a body cell that loses its note, and alignment from
  // the content that does not reach the cell.
  it('prints the note of a footnote in a body cell, and right-aligns a cell', async () => {
    const content = await parseRichTextMarkdown('| Site | t/ha |\n| - | -: |\n| North[^1] | 4 |\n| South | 1200 |\n\n[^1]: Drained in 1970.\n')
    const { parsed } = await renderWithWarnings(() => [h(PdfRichText, { content })])
    const runs = runsOf(parsed)
    expect(runs.some(run => run.text.includes('Drained in 1970.'))).toBe(true)
    const right = (text: string) => {
      const run = runs.find(item => item.text === text)!
      return Math.round((run.x + run.width) * 100) / 100
    }
    expect(right('4')).toBe(right('1200'))
    expect(right('t/ha')).toBe(right('1200'))
  })

  // Catches col widths taken as points or percentages of the page: editors
  // write screen widths (TipTap: 300px columns), which would run past the
  // page. They are the proportions of the columns, and the table fills its room.
  it.each([
    ['two columns of 60%', '<col style="width: 60%"><col style="width: 60%">', 1],
    ['two columns of 400px', '<col width="400px"><col width="400px">', 1],
    ['300px and 150px', '<col style="width: 300px"><col style="width: 150px">', 2],
  ])('keeps a table with col widths of %s inside the content width, in their proportion', async (_name, cols, ratio) => {
    const { parsed } = await renderWithWarnings(() => [h(PdfRichText, { html: `<table>${cols}<tr><td>A</td><td>B</td></tr></table>` })])
    const a = runOf(parsed, 'A')
    const b = runOf(parsed, 'B')
    // Each text starts 0.5 em (5 pt) inside its cell: the second cell starts at b.x - 5.
    const first = b.x - 5 - 40
    const second = RIGHT - (b.x - 5)
    expect(a.x).toBe(45)
    expect(Math.round((first / second) * 1000) / 1000).toBe(ratio)
  })

  // Catches header cells and row headers that get only the tableCell style:
  // bold by default, and a custom tableHeaderCell style reaches both, not a
  // body cell. Font names compare within one PDF: `Ref` is plain bold text.
  it('gives header cells and row headers the tableHeaderCell style over tableCell', async () => {
    const html = '<table><thead><tr><th>Head</th><th>Top</th></tr></thead><tr><th>Side</th><td>Body</td></tr></table><p><strong>Ref</strong></p>'
    const fonts = (parsed: ParsedPdf) => Object.fromEntries(['Head', 'Top', 'Side', 'Body', 'Ref'].map(text => [text, runOf(parsed, text).fontName]))
    const plain = fonts((await renderWithWarnings(() => [h(PdfRichText, { html })])).parsed)
    expect([plain.Head, plain.Top, plain.Side]).toEqual([plain.Ref, plain.Ref, plain.Ref])
    expect(plain.Body).not.toBe(plain.Ref)
    const italic = fonts((await renderWithWarnings(() => [h(PdfRichText, { html, styles: { tableHeaderCell: { fontStyle: 'italic' } } })])).parsed)
    expect(italic.Side).toBe(italic.Head)
    expect(italic.Head).not.toBe(italic.Ref)
    expect([italic.Body, italic.Ref]).not.toContain(italic.Head)
    expect(italic.Body).not.toBe(italic.Ref)
  })

  // Catches cell defaults in points: the padding is 0.5 em of the body size beside the text.
  it.each([[9, 44.5], [12, 46]])('pads cells by the body size of %d pt', async (body, x) => {
    const { parsed } = await renderWithWarnings(() => [h(PdfView, { style: { fontSize: body } }, () => h(PdfRichText, { html: '<table><tr><td>Cell</td></tr></table>' }))])
    expect(runOf(parsed, 'Cell').x).toBe(x)
  })
})

describe('validateRichText', () => {
  const deep = (depth: number): PdfRichBlock => depth <= 1
    ? { type: 'paragraph', children: [{ type: 'text', text: 'a' }] }
    : { type: 'quote', children: [deep(depth - 1)] }

  // Catches a wrong node that passes, or an issue without its path.
  it.each<[string, unknown, Array<[string, string]>]>([
    ['a valid model', [{ type: 'heading', level: 2, children: [{ type: 'text', text: 'a', bold: true, italic: false }, { type: 'text', text: '2', verticalAlign: 'super' }, { type: 'footnote', key: 'n', children: [{ type: 'text', text: 'note' }] }, { type: 'footnote', key: 'n' }, { type: 'footnote', children: [{ type: 'break' }] }] }, { type: 'list', ordered: true, start: 0, items: [[], [{ type: 'rule' }]] }, { type: 'code', text: 'x' }], []],
    ['not an array', { type: 'paragraph' }, [['content', 'expected an array, found an object']]],
    ['an unknown block type', [{ type: 'video' }], [['content[0].type', 'expected a block type (paragraph, heading, list, quote, code, rule, image, table, component), found "video"']]],
    ['an inline node as a block', [{ type: 'text', text: 'a' }], [['content[0].type', 'expected a block type (paragraph, heading, list, quote, code, rule, image, table, component), found "text"']]],
    ['a block as an inline node', [{ type: 'paragraph', children: [{ type: 'paragraph', children: [] }] }], [['content[0].children[0].type', 'expected "text", "link", "break" or "footnote" inline, found "paragraph"']]],
    ['an unknown field', [{ type: 'paragraph', children: [{ type: 'text', text: 'a', bolt: true }] }], [['content[0].children[0].bolt', 'a text node has no field "bolt"']]],
    ['a text that is not a string', [{ type: 'code', text: 42 }], [['content[0].text', 'expected a string, found 42']]],
    ['a mark that is not a boolean', [{ type: 'paragraph', children: [{ type: 'text', text: 'a', bold: 'yes' }] }], [['content[0].children[0].bold', 'expected true or false, found "yes"']]],
    ['a verticalAlign that is not super or sub', [{ type: 'paragraph', children: [{ type: 'text', text: 'a', verticalAlign: 'baseline' }] }], [['content[0].children[0].verticalAlign', 'expected "super" or "sub", found "baseline"']]],
    // Catches a footnote the render cannot print: inside a link (its mark is a
    // link), inside a note, a repeat of no note, or a note with no content.
    ['footnotes in the wrong places', [{ type: 'paragraph', children: [
      { type: 'link', href: 'https://example.test', children: [{ type: 'footnote', children: [{ type: 'text', text: 'a' }] }] },
      { type: 'footnote', children: [{ type: 'footnote', key: 'inner', children: [{ type: 'text', text: 'b' }] }] },
      { type: 'footnote', key: 'later' },
      { type: 'footnote' },
      { type: 'footnote', key: 'n', children: [] },
      { type: 'footnote', key: 'n', children: [{ type: 'text', text: 'c' }] },
    ] }], [
      ['content[0].children[0].children[0]', 'a footnote cannot be inside a link: its mark is a link to the note'],
      ['content[0].children[1].children[0]', 'a footnote cannot be inside the note of another footnote'],
      ['content[0].children[2].key', 'no earlier footnote has the key "later"'],
      ['content[0].children[3]', 'expected "children" (the note), or the "key" of an earlier footnote to mark it again'],
      ['content[0].children[4].children', 'expected the note, found an empty array'],
      ['content[0].children[5].key', 'an earlier footnote has the key "n"; leave out "children" to mark that note again'],
    ]],
    ['a heading level out of range', [{ type: 'heading', level: 7, children: [] }], [['content[0].level', 'expected a whole number from 1 to 6, found 7']]],
    ['a list start below 0', [{ type: 'list', ordered: true, start: -1, items: [] }], [['content[0].start', 'expected a whole number from 0, found -1']]],
    ['list items that are not arrays', [{ type: 'list', ordered: false, items: [{ type: 'paragraph', children: [] }] }], [['content[0].items[0]', 'expected an array, found an object']]],
    ['a deep path', [{ type: 'list', ordered: false, items: [[{ type: 'paragraph', children: [{ type: 'text', text: 'a' }] }, { type: 'paragraph', children: [{ type: 'text', text: 'b' }, { type: 'break' }, { type: 'link', href: 'https://example.test', children: [{ type: 'text', text: 'c' }, { type: 'link', href: '/x', children: [] }] }] }]] }], [
      ['content[0].items[0][1].children[2].children[1]', 'a link cannot be inside a link'],
      ['content[0].items[0][1].children[2].children[1].href', 'expected an absolute http:, https:, mailto: or tel: URL, found "/x"'],
    ]],
    // Catches a table model that passes the check and then fails in PdfTable,
    // or one that PdfTable renders but the check refuses.
    ['a valid table', [{ type: 'table', columns: ['auto', 2], header: [{ children: [] }, { children: [], align: 'right' }], rows: [[{ children: [{ type: 'paragraph', children: [{ type: 'text', text: 'a' }, { type: 'footnote', children: [{ type: 'text', text: 'n' }] }] }], rowspan: 2, header: true }, { children: [] }], [{ children: [] }]], caption: [{ type: 'text', text: 'c' }] }], []],
    ['table cells in the wrong shape', [{ type: 'table', header: [{ children: [{ type: 'paragraph', children: [{ type: 'footnote', children: [{ type: 'text', text: 'n' }] }] }], rowspan: 2 }], rows: [[{ children: [{ type: 'heading', level: 1, children: [] }], colspan: 0, align: 'justify', header: 'yes', width: 3 }]] }], [
      ['content[0].header[0].children[0]', 'a header cell cannot hold a footnote: the header repeats on every page, and so would its note'],
      ['content[0].header[0].rowspan', 'a header cell cannot span rows: the header repeats as one row'],
      ['content[0].rows[0][0].width', 'a cell node has no field "width"'],
      ['content[0].rows[0][0].children[0].type', 'expected "paragraph": a table cell holds paragraphs only, found "heading"'],
      ['content[0].rows[0][0].colspan', 'expected a whole number from 1, found 0'],
      ['content[0].rows[0][0].align', 'expected "left", "center" or "right", found "justify"'],
      ['content[0].rows[0][0].header', 'expected true or false, found "yes"'],
    ]],
    ['table spans that do not fit', [{ type: 'table', rows: [[{ children: [] }, { children: [], rowspan: 3 }], [{ children: [], colspan: 2 }]] }], [
      ['content[0].rows[0][1].rowspan', 'the cell spans 3 rows, but the table has only 2 rows from its row to the end'],
      ['content[0].rows[1][0].colspan', 'the cell spans 2 columns, but a rowspan from a row above takes column 2'],
    ]],
    ['table column widths that do not fit', [
      { type: 'table', columns: ['auto'], rows: [[{ children: [] }, { children: [] }]] },
      { type: 'table', columns: ['30%', 'auto'], header: [{ children: [], colspan: 2 }], rows: [] },
      { type: 'table', columns: ['10mm', '20pt', 'auto'], rows: [[{ children: [], colspan: 2 }, { children: [] }]] },
      { type: 'table', columns: [0], rows: [[{ children: [] }]] },
      { type: 'table', rows: [] },
    ], [
      ['content[0].columns', 'expected 2 column widths, one per column, found an array'],
      ['content[1].header[0].colspan', 'the cell spans a percentage column and an \'auto\' or share column of a table with \'auto\' columns'],
      ['content[2].rows[0][0].colspan', 'the cell spans columns in "mm" and "pt", whose widths cannot be added'],
      ['content[3].columns[0]', 'expected a share above 0, \'auto\', or a width such as \'30%\' or \'80pt\', found 0'],
      ['content[4].rows', 'expected at least one cell'],
    ]],
    ['a node that is null', [null], [['content[0]', 'expected a node object, found null']]],
    ['nesting over the limit', [deep(33)], [[`content[0]${'.children[0]'.repeat(32)}`, 'nesting depth 33 is over the limit of 32']]],
    ['text over the length limit', [{ type: 'code', text: 'x'.repeat(1_000_001) }], [['content[0].text', 'the text is longer than the limit of 1000000 characters']]],
  ])('%s', (_name, content, expected) => {
    expect(validateRichText(content).map(issue => [issue.path, issue.message])).toEqual(expected)
  })

  // Catches a message that quotes the article text (D23).
  it('never quotes the text of a node', () => {
    const issues = validateRichText([{ type: 'paragraph', children: [{ type: 'text', text: 'Confidential salary figures', color: 'red' }] }])
    expect(JSON.stringify(issues)).not.toContain('Confidential')
  })

  it('stops at 50,000 nodes and at 20 issues', () => {
    const many = Array.from({ length: 50_001 }, () => ({ type: 'rule' }))
    expect(validateRichText(many)).toEqual([{ rule: 'PDF-RICH-LIMIT', path: 'content[50000]', message: '50001 nodes are over the limit of 50000' }])
    expect(validateRichText(Array.from({ length: 30 }, () => ({ type: 'x' })))).toHaveLength(20)
  })
})

describe('the TipTap recipe of the rich text docs', () => {
  // Catches a recipe on the docs page that no longer runs or no longer gives a
  // valid model: it is the code users copy.
  it('maps TipTap JSON to a model that validates and renders', async () => {
    const page = readFileSync('docs/content/docs/13.rich-text.md', 'utf8')
    const source = /```ts \[server\/utils\/tiptap\.ts\]\n([\s\S]*?)\n```/.exec(page)![1]!
    const directory = mkdtempSync(join(tmpdir(), 'nuxt-pdf-tiptap-'))
    try {
      const file = join(directory, 'tiptap.mjs')
      writeFileSync(file, (await transform(source, { loader: 'ts', format: 'esm' })).code)
      const recipe: unknown = await import(pathToFileURL(file).href)
      if (typeof recipe !== 'object' || recipe === null || !('tiptapToRichText' in recipe) || typeof recipe.tiptapToRichText !== 'function') throw new Error('no tiptapToRichText export')
      const text = (value: string, ...marks: string[]) => ({ type: 'text', text: value, ...(marks.length > 0 ? { marks: marks.map(type => ({ type })) } : {}) })
      const content: unknown = recipe.tiptapToRichText({ type: 'doc', content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('Harvest day')] },
        { type: 'paragraph', content: [text('Bring '), text('gloves', 'bold', 'italic'), text('2', 'superscript'), { type: 'hardBreak' }, { type: 'text', text: 'and the map', marks: [{ type: 'link', attrs: { href: 'https://example.test/map' } }] }] },
        { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('Pick')] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('Sort')] }] }] }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [text('Rest at noon.')] }] },
        { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'rows: 12' }] },
        { type: 'horizontalRule' },
        { type: 'image', attrs: { src: 'x.png' } },
      ] })

      expect(content).toEqual([
        { type: 'heading', level: 2, children: [{ type: 'text', text: 'Harvest day' }] },
        { type: 'paragraph', children: [{ type: 'text', text: 'Bring ' }, { type: 'text', text: 'gloves', bold: true, italic: true }, { type: 'text', text: '2', verticalAlign: 'super' }, { type: 'break' }, { type: 'link', href: 'https://example.test/map', children: [{ type: 'text', text: 'and the map' }] }] },
        { type: 'list', ordered: true, start: 3, items: [[{ type: 'paragraph', children: [{ type: 'text', text: 'Pick' }] }, { type: 'list', ordered: false, items: [[{ type: 'paragraph', children: [{ type: 'text', text: 'Sort' }] }]] }]] },
        { type: 'quote', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Rest at noon.' }] }] },
        { type: 'code', text: 'rows: 12' },
        { type: 'rule' },
      ])
      expect(validateRichText(content)).toEqual([])
      assertRichText(content)
      const parsed = await render(() => [h(PdfRichText, { content })])
      expect(parsed.pages[0]!.text.replace(/\s+/g, ' ').trim()).toBe('Harvest day Bring gloves2 and the map 3. Pick - Sort Rest at noon. rows: 12')
    }
    finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
