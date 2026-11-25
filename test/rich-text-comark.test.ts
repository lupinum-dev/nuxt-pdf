import { performance } from 'node:perf_hooks'
import { parseMarkdown } from 'comark'
import footnotes from 'comark/plugins/footnotes'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseRichTextMarkdown, validateRichText } from '../src/runtime/rich-text'
import { mapComark } from '../src/runtime/rich-text/comark'
import { MAX_RICH_TEXT_MARKDOWN_LENGTH } from '../src/runtime/rich-text/limits'
import { isRichTextComponentTag, RICH_TEXT_DROPPED_TAGS } from '../src/runtime/rich-text/map'
import { loadComarkParser } from '../src/runtime/rich-text/markdown-parse'
import type { PdfRichBlock, PdfRichComponent, PdfRichInline, PdfRichParagraph, PdfRichTextRun } from '../src/runtime/rich-text/types'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'

// Short builders for the expected models; each returns the literal node.
type Marks = Omit<PdfRichTextRun, 'type' | 'text'>
const t = (text: string, marks: Marks = {}): PdfRichTextRun => ({ type: 'text', text, ...marks })
const br: PdfRichInline = { type: 'break' }
const a = (href: string, ...children: PdfRichInline[]): PdfRichInline => ({ type: 'link', href, children })
const p = (...children: PdfRichInline[]): PdfRichParagraph => ({ type: 'paragraph', children })
const h = (level: 1 | 2 | 3 | 4 | 5 | 6, ...children: PdfRichInline[]): PdfRichBlock => ({ type: 'heading', level, children })
const quote = (...children: PdfRichBlock[]): PdfRichBlock => ({ type: 'quote', children })
const code = (text: string, language?: string): PdfRichBlock => language === undefined ? { type: 'code', text } : { type: 'code', text, language }
const component = (name: string, props: PdfRichComponent['props'], children: PdfRichBlock[], slots?: PdfRichComponent['slots']): PdfRichBlock =>
  slots === undefined ? { type: 'component', name, props, children } : { type: 'component', name, props, children, slots }

/** `unit` repeated to exactly `length` characters. */
const fill = (unit: string, length: number): string => unit.repeat(Math.ceil(length / unit.length)).slice(0, length)

const rejection = async (run: () => Promise<unknown>): Promise<NuxtPdfError> => {
  try {
    await run()
  }
  catch (error) {
    if (error instanceof NuxtPdfError) return error
    throw error
  }
  throw new Error('expected a NuxtPdfError')
}

describe('parseRichTextMarkdown', () => {
  // Catches a Markdown construct that comark writes and the mapping loses,
  // doubles or maps to the wrong node. Each expected model is literal.
  it.each<[string, string, PdfRichBlock[]]>([
    ['marks, a link, raw u and a hard break', 'Para **b** *i* ~~s~~ `c` [l](https://e.test) <u>u</u>  \nnext', [
      p(t('Para '), t('b', { bold: true }), t(' '), t('i', { italic: true }), t(' '), t('s', { strike: true }), t(' '), t('c', { code: true }), t(' '), a('https://e.test', t('l')), t(' '), t('u', { underline: true }), br, t('next')),
    ]],
    // Catches raw sup and sub in Markdown that lose their place; comark has no ~2~ or ^2^ syntax, so those stay text.
    ['raw sub and sup are raised and lowered, ~2~ and ^2^ stay literal', 'H~2~O m^2^ CO<sub>2</sub> m<sup>2</sup>', [
      p(t('H~2~O m^2^ CO'), t('2', { verticalAlign: 'sub' }), t(' m'), t('2', { verticalAlign: 'super' })),
    ]],
    ['a heading, its id ignored', '## Field notes', [h(2, t('Field notes'))]],
    ['a tight and a nested list', '- a\n- b\n  1. c\n', [{ type: 'list', ordered: false, items: [[p(t('a'))], [p(t('b')), { type: 'list', ordered: true, items: [[p(t('c'))]] }]] }]],
    ['a list that starts at 3', '3. a\n4. b\n', [{ type: 'list', ordered: true, start: 3, items: [[p(t('a'))], [p(t('b'))]] }]],
    ['a quote', '> q', [quote(p(t('q')))]],
    ['a fenced code block keeps its language and indentation', '```js\nlet a = 1\n  b\n```', [code('let a = 1\n  b', 'js')]],
    ['an indented code block has no language', '    plain', [code('plain')]],
    ['a rule', 'a\n\n***\n\nb', [p(t('a')), { type: 'rule' }, p(t('b'))]],
    ['an image ends the paragraph and becomes a block', 'a ![a photo](x.png) b\n\n![alone](y.png)', [p(t('a')), { type: 'image', src: 'x.png', alt: 'a photo' }, p(t('b')), { type: 'image', src: 'y.png', alt: 'alone' }]],
    // Catches a GFM table flattened to paragraphs, or its alignment (comark writes text-align) lost.
    ['a table with its header and alignment', '| a | b | c |\n| :- | -: | - |\n| d | e | f |\n', [{
      type: 'table',
      header: [{ children: [p(t('a'))], align: 'left' }, { children: [p(t('b'))], align: 'right' }, { children: [p(t('c'))] }],
      rows: [[{ children: [p(t('d'))], align: 'left' }, { children: [p(t('e'))], align: 'right' }, { children: [p(t('f'))] }]],
    }]],
    ['a task list keeps its text, not the box', '- [ ] todo\n- [x] done\n', [{ type: 'list', ordered: false, items: [[p(t('todo'))], [p(t('done'))]] }]],
    ['a footnote becomes a footnote with its note', 'Text[^1]\n\n[^1]: Note.\n', [p(t('Text'), { type: 'footnote', key: 'fn-1', children: [t('Note.')] })]],
    // Catches a note that keeps its Markdown source (`**2024**`), and a second
    // reference that gets a second body instead of the same note.
    ['a note with inline Markdown, referenced twice', 'Peat[^p] and bogs[^p].\n\n[^p]: Source, **2024**, [page](https://e.test).\n', [
      p(t('Peat'), { type: 'footnote', key: 'fn-p', children: [t('Source, '), t('2024', { bold: true }), t(', '), a('https://e.test', t('page')), t('.')] }, t(' and bogs'), { type: 'footnote', key: 'fn-p' }, t('.')),
    ]],
    ['a definition without a reference is dropped', 'Text.\n\n[^u]: Unused.\n', [p(t('Text.'))]],
    ['frontmatter is ignored', '---\ntitle: Report\n---\n\nBody', [p(t('Body'))]],
    ['references are decoded once, by comark', '&amp; &copy; &#65; a&nbsp;b `&amp;`', [p(t('& © A a b '), t('&amp;', { code: true }))]],
    ['raw block HTML: script dropped with its content, the rest mapped', '<script>alert(1)</script>\n\n<div>a <b>b</b></div>', [p(t('a '), t('b', { bold: true }))]],
    ['raw inline HTML: script dropped, span transparent', 'x <span>y</span> <script>z</script>', [p(t('x y'))]],
    ['a javascript: link stays text in Markdown, and loses its target in raw HTML', '[x](javascript:alert(1)) <a href="javascript:x">raw</a>', [p(t('[x](javascript:alert(1)) raw'))]],
    ['a block component with props', '::alert{type="info"}\nHello **x**\n::', [component('alert', { type: 'info' }, [p(t('Hello '), t('x', { bold: true }))])]],
    ['bound props are JSON; class, id and style are not props', '::card{:count="3" title="T" .wide #intro :flag="true" :list=\'[1,2]\'}\nc\n::', [component('card', { count: 3, title: 'T', flag: true, list: [1, 2] }, [p(t('c'))])]],
    ['a named slot', '::card\n#title\nT\n#default\nBody\n::', [component('card', {}, [p(t('Body'))], { title: [p(t('T'))] })]],
    ['a component inside a component', '::outer\n:::inner{x=1}\ndeep\n:::\n::', [component('outer', {}, [component('inner', { x: '1' }, [p(t('deep'))])])]],
    ['an inline component keeps its text, without the component', 'Before :badge{a=1} after', [p(t('Before after'))]],
    // A component in a list item is inline: its named slot's text would be
    // lost if only the default content printed.
    ['a component in a list item keeps the text of its named slot, then its default content', '- item\n\n  ::card\n  #title\n  Named\n  #default\n  Loose\n  ::\n', [{ type: 'list', ordered: false, items: [[p(t('item')), p(t('NamedLoose'))]] }]],
    ['a component named constructor is a component like any other', '::constructor\ny\n::', [component('constructor', {}, [p(t('y'))])]],
    ['comark writes toString as to-string', '::toString{a=1}\ny\n::', [component('to-string', { a: '1' }, [p(t('y'))])]],
    ['an HTML comment is dropped', 'a <!-- note --> b\n\n<!-- block -->', [p(t('a b'))]],
    ['empty input', '', []],
  ])('%s', async (_name, markdown, expected) => {
    const model = await parseRichTextMarkdown(markdown)
    expect(model).toEqual(expected)
    expect(validateRichText(model)).toEqual([])
  })

  // Catches untrusted Markdown that reaches the layout over a limit, or a
  // length check that runs after the parse.
  it('fails over the depth limit and, before parsing, over the length limit', async () => {
    expect(await rejection(() => parseRichTextMarkdown(`${'> '.repeat(40)}x`))).toMatchObject({
      code: PDF_ERROR_CODES.RichTextInvalid,
      issues: [{ rule: 'PDF-RICH-LIMIT', path: `markdown[0]${'[2]'.repeat(32)}`, message: 'nesting depth 33 is over the limit of 32' }],
    })
    const started = performance.now()
    expect(await rejection(() => parseRichTextMarkdown('a'.repeat(MAX_RICH_TEXT_MARKDOWN_LENGTH + 1)))).toMatchObject({
      code: PDF_ERROR_CODES.RichTextInvalid,
      issues: [{ rule: 'PDF-RICH-LIMIT', path: 'markdown', message: 'the Markdown is 250001 characters long, over the limit of 250000' }],
    })
    expect(performance.now() - started).toBeLessThan(50)
    expect((await rejection(() => parseRichTextMarkdown(42 as unknown as string))).issues).toEqual([{ rule: 'PDF-RICH-NODE', path: 'markdown', message: 'expected a string, found 42' }])
  })

  // Catches a reference that prints a stray `^z` instead of a note, a code
  // block that loses a line comark's footnotes plugin takes out of it, and a
  // footnote with an empty note (an invalid model).
  it.each([
    ['a reference without a definition', 'No note[^z].\n', 'markdown: a footnote reference has no note: write its definition, such as "[^1]: The note."'],
    // A note is one paragraph: a list would be joined into one line.
    ['a note that is a list', 'Text[^x]\n\n[^x]: - one\n', 'markdown: the footnote "fn-x" holds <ul>, but a note is one paragraph of text. Write the note as one paragraph'],
    // Found by the property below (CI run 81): `[^1]::alert…` is a definition
    // whose note is a component, which keeps no text; the model had a
    // footnote with an empty note.
    ['a note that keeps no text', '[^1]::alert{type=info}\n![^1]: n\n', 'markdown: the footnote "fn-1" has no text in its note. Write the note as text, such as "[^1]: The note."'],
    ['a definition line in a fenced code block', 'Text[^x]\n\n```md\n[^x]: in code\n```\n\n[^x]: The note.\n', 'markdown: line 4 starts like a footnote definition inside a fenced code block, and comark would take it out of the code. Indent the code by four spaces instead of fencing it'],
  ])('fails on %s', async (_name, markdown, message) => {
    const error = await rejection(() => parseRichTextMarkdown(markdown))
    expect(error.code).toBe(PDF_ERROR_CODES.RichTextInvalid)
    expect(error.message).toBe(`Rich text input is invalid: ${message}.`)
  })

  // Catches an input at the length limit that fails with an untyped error or
  // passes the default time limit. These take at most about 0.4 s in comark
  // itself; inputs that take seconds are in rich-text-markdown-worker.test.ts.
  const tail = '<!--\n'.repeat(20)
  it.each([
    ['words', fill('word ', MAX_RICH_TEXT_MARKDOWN_LENGTH)],
    ['brackets', fill('[', MAX_RICH_TEXT_MARKDOWN_LENGTH)],
    ['angle brackets', fill('<', MAX_RICH_TEXT_MARKDOWN_LENGTH)],
    ['component fences', fill('::a\n', MAX_RICH_TEXT_MARKDOWN_LENGTH)],
    ['nested list markers', fill('- ', MAX_RICH_TEXT_MARKDOWN_LENGTH)],
    ['image openers', fill('![', MAX_RICH_TEXT_MARKDOWN_LENGTH)],
    ['table rows', fill('|-|\n', MAX_RICH_TEXT_MARKDOWN_LENGTH)],
    ['20 unclosed comments, then text', tail + fill('a\n\n', MAX_RICH_TEXT_MARKDOWN_LENGTH - tail.length)],
    ['20 closed comments, spread', `<!-- a -->\n${'a\n\n'.repeat(4_160)}`.repeat(20)],
    ['20 comments in quotes', `> <!--\n${'a\n'.repeat(6_240)}`.repeat(20)],
  ])('settles %s at the length limit within 3 s, with a model or the typed error', async (_name, markdown) => {
    expect(markdown.length).toBeLessThanOrEqual(MAX_RICH_TEXT_MARKDOWN_LENGTH)
    const started = performance.now()
    try {
      await parseRichTextMarkdown(markdown)
    }
    catch (error) {
      expect(error).toBeInstanceOf(NuxtPdfError)
      expect(error).toMatchObject({ code: PDF_ERROR_CODES.RichTextInvalid })
    }
    expect(performance.now() - started).toBeLessThan(3_000)
  }, 20_000)
})

describe('the comark input', () => {
  // Catches a tree from a project's own parse that maps differently from Markdown.
  it('takes the document or its node list', () => {
    const nodes = [['p', {}, 'a ', ['strong', {}, 'b']], ['alert', { type: 'info' }, 'c']]
    const expected = [p(t('a '), t('b', { bold: true })), component('alert', { type: 'info' }, [p(t('c'))])]
    expect(mapComark(nodes)).toEqual(expected)
    expect(mapComark({ frontmatter: { title: 'x' }, meta: {}, nodes })).toEqual(expected)
  })

  // Catches a wrong shape that reaches the mapping, or an issue without its path.
  it.each<[string, unknown, Array<[string, string]>]>([
    ['not a list', 'text', [['comark', 'expected a list of comark nodes, found "text"']]],
    ['nodes that are not a list', { nodes: 5 }, [['comark.nodes', 'expected a list of comark nodes, found 5']]],
    ['a node that is a number', [42], [['comark[0]', 'expected a text or a [tag, props, ...children] node, found 42']]],
    ['an empty tag', [['', {}]], [['comark[0][0]', 'expected a tag name, found ""']]],
    ['props that are text', [['p', 'x']], [['comark[0][1]', 'expected a props object, found "x"']]],
    ['props left out', [['p']], [['comark[0][1]', 'expected a props object, found undefined']]],
    ['a deep wrong child', { nodes: [['ul', {}, ['li', {}, 'ok', null]]] }, [['comark.nodes[0][2][3]', 'expected a text or a [tag, props, ...children] node, found null']]],
  ])('fails on %s', (_name, value, expected) => {
    let error: unknown
    try {
      mapComark(value)
    }
    catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(NuxtPdfError)
    expect(error).toMatchObject({ code: PDF_ERROR_CODES.RichTextInvalid })
    expect(error instanceof NuxtPdfError ? error.issues?.map(issue => [issue.path, issue.message]) : []).toEqual(expected)
  })

  // Catches a component name or prop name that reaches an object prototype.
  it('keeps prototype names as plain component names and drops a __proto__ prop', () => {
    const props: unknown = JSON.parse('{"__proto__":{"polluted":true},"ok":"y",":n":"2"}')
    const model = mapComark([['constructor', {}, 'a'], ['__proto__', {}, 'b'], ['toString', props, 'c']])
    expect(model).toEqual([
      component('constructor', {}, [p(t('a'))]),
      component('__proto__', {}, [p(t('b'))]),
      component('toString', { ok: 'y', n: 2 }, [p(t('c'))]),
    ])
    expect(Object.getPrototypeOf(model[2]!.type === 'component' ? model[2]!.props : null)).toBe(Object.prototype)
    expect(validateRichText(model)).toEqual([])
  })

  it('fails over the depth limit', () => {
    let tree: unknown = 'x'
    for (let level = 0; level < 40; level += 1) tree = ['blockquote', {}, tree]
    let error: unknown
    try {
      mapComark([tree])
    }
    catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: PDF_ERROR_CODES.RichTextInvalid, issues: [{ rule: 'PDF-RICH-LIMIT', path: `comark[0]${'[2]'.repeat(32)}` }] })
  })
})

describe('the comark package', () => {
  // Catches a missing optional peer that surfaces as a raw module error
  // without the package name and the install command.
  it('names comark and the install command when it is missing, and keeps other load errors', async () => {
    const missing = Object.assign(new Error('Cannot find package \'comark\''), { code: 'ERR_MODULE_NOT_FOUND' })
    expect(await rejection(() => loadComarkParser(() => Promise.reject(missing)))).toMatchObject({
      code: PDF_ERROR_CODES.RenderError,
      message: 'parseRichTextMarkdown needs the optional peer dependency "comark", which is not installed. Install it: pnpm add comark',
      cause: missing,
    })
    const broken = new SyntaxError('Unexpected token')
    await expect(loadComarkParser(() => Promise.reject(broken))).rejects.toBe(broken)
  })
})

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

type ComarkNode = string | [string, Record<string, unknown>, ...ComarkNode[]]
const isComarkElement = (node: unknown): node is [string, Record<string, unknown>, ...ComarkNode[]] => Array.isArray(node) && typeof node[0] === 'string'

/**
 * The text comark's nodes hold for the allowed tags: every text, except
 * inside a dropped tag (`script`, `style`, `template` and the others), where
 * a `template` directly in a component is a slot and counts. The footnote
 * markup is left out (the reference's `[1]` and the list of notes): the
 * notes are parsed again, and their rows check their text.
 */
const comarkText = (nodes: readonly unknown[], parentIsComponent = false): string => nodes.map((node) => {
  if (typeof node === 'string') return node
  if (!isComarkElement(node)) return ''
  const [tag, attributes, ...children] = node
  const name = tag.toLowerCase()
  const isSlot = name === 'template' && parentIsComponent
  if (RICH_TEXT_DROPPED_TAGS.has(name) && !isSlot) return ''
  if (attributes.class === 'footnote-ref' || attributes.class === 'footnotes') return ''
  return comarkText(children, isRichTextComponentTag(tag))
}).join('')

const inlineText = (nodes: readonly PdfRichInline[]): string => nodes.map(node => node.type === 'text' ? node.text : node.type === 'link' ? inlineText(node.children) : '').join('')
const modelText = (blocks: readonly PdfRichBlock[]): string => blocks.map((block) => {
  switch (block.type) {
    case 'paragraph':
    case 'heading': return inlineText(block.children)
    case 'list': return block.items.map(modelText).join('')
    case 'quote': return modelText(block.children)
    case 'code': return block.text
    case 'rule': return ''
    case 'table': return [inlineText(block.caption ?? []), ...[block.header ?? [], ...block.rows].flat().map(cell => modelText(cell.children))].join('')
    case 'component': return [...Object.values(block.slots ?? {}).map(modelText), modelText(block.children)].join('')
  }
}).join('')
const letters = (text: string): string => [...text.replace(/\s/g, '')].sort().join('')

// Pieces of Markdown that comark gives meaning, joined at random.
const piece = fc.constantFrom(
  'field', 'note', 'Ärger', 'a&b', '1 < 2', ' ', '\n', '\n\n', '**', '*', '_', '~~', '`', '```', '```js\n', '\n```\n',
  '# ', '## ', '- ', '1. ', '> ', '---\n', '***', '[x](https://e.test)', '[y](javascript:alert(1))', '![i](x.png)',
  '<b>', '</b>', '<script>', '</script>', '<template>', '</template>', '<!--', '-->', '&amp;', '&nbsp;', '\\',
  '| a | b |\n| - | - |\n', '::alert{type=info}\n', '::card\n', '#title\n', '::\n', ':badge{a=1}', '[^1]', '[^1]: n\n', '- [ ] ',
)
const markdown = fc.array(fc.oneof(piece, fc.string({ maxLength: 6 })), { maxLength: 40 }).map(parts => parts.join(''))

// A fixed seed, so a run of the suite is red or green by the code and not by
// chance. To explore, change the seed and the number of runs of each property:
//   NUXT_PDF_RICH_TEXT_SEED=7 NUXT_PDF_RICH_TEXT_RUNS=3000 pnpm vitest run test/rich-text-comark.test.ts
const SEED = Number(process.env.NUXT_PDF_RICH_TEXT_SEED) || 20_261_123
const RUNS = Number(process.env.NUXT_PDF_RICH_TEXT_RUNS) || 300
const TIMEOUT = 60_000 * Math.max(1, RUNS / 300)

describe('parseRichTextMarkdown properties', () => {
  // Catches any input that fails with an untyped error (a crash in the
  // mapping) instead of a model or PDF_RICH_TEXT_INVALID.
  it(`parses any string, or fails with PDF_RICH_TEXT_INVALID (seed ${SEED})`, async () => {
    await fc.assert(fc.asyncProperty(markdown, async (source) => {
      try {
        const model = await parseRichTextMarkdown(source)
        expect(validateRichText(model)).toEqual([])
      }
      catch (error) {
        expect(error).toBeInstanceOf(NuxtPdfError)
        expect(error).toMatchObject({ code: PDF_ERROR_CODES.RichTextInvalid })
      }
    }), { numRuns: RUNS, seed: SEED })
  }, TIMEOUT)

  // Catches text the mapping loses or invents. The rule: the characters of
  // the model, without whitespace, are the characters comark's nodes hold
  // outside dropped tags, without whitespace (sorted, since a slot moves
  // before the default content).
  it(`keeps the text of comark's nodes for the allowed tags (seed ${SEED})`, async () => {
    await fc.assert(fc.asyncProperty(markdown, async (source) => {
      let nodes: Awaited<ReturnType<typeof parseMarkdown>>['nodes']
      try {
        nodes = (await parseMarkdown(source, { plugins: [footnotes({ label: '', hr: false })] })).nodes
      }
      catch {
        // comark itself rejects some inputs (a component with a broken YAML
        // block): then the function fails with the typed error.
        await expect(parseRichTextMarkdown(source)).rejects.toMatchObject({ code: PDF_ERROR_CODES.RichTextInvalid })
        return
      }
      let model: PdfRichBlock[]
      try {
        model = await parseRichTextMarkdown(source)
      }
      catch (error) {
        // A reference without a note, or a definition line in a code fence,
        // fails typed instead of printing a stray `^1` or losing a code line.
        if (error instanceof NuxtPdfError && error.message.includes('footnote')) return
        // An image in a table cell fails typed instead of being flattened.
        if (error instanceof NuxtPdfError && error.message.includes('a table cell holds')) return
        throw error
      }
      expect(letters(modelText(model))).toBe(letters(comarkText(nodes)))
    }), { numRuns: RUNS, seed: SEED })
  }, TIMEOUT)

  // The input the property above found (seed 1271946700): a component inside
  // a paragraph dropped the text of its slot, because the slot is a
  // `template`, which the mapping removes elsewhere. A component that is not
  // a block prints the text of its slots, as a block component does.
  it.each([
    { source: ':C[<template>!', expected: [p(t('!(comark:incomplete-link)'))] },
    { source: 'a :badge[<template>!] b', expected: [p(t('a ! b'))] },
    { source: '# H :badge[<template>!]', expected: [h(1, t('H !'))] },
    { source: '- a :badge[<template>!]', expected: [{ type: 'list', ordered: false, items: [[p(t('a !'))]] }] },
  ])('keeps the slot text of a component in $source', async ({ source, expected }) => {
    expect(await parseRichTextMarkdown(source)).toEqual(expected)
  })

  // The input the property above found: comark throws a YAML error for it.
  it('fails with PDF_RICH_TEXT_INVALID, without comark\'s message, when comark cannot parse', async () => {
    await expect(parseMarkdown('::card\n---\n>')).rejects.toThrow('missing indentation')
    const error: unknown = await parseRichTextMarkdown('::card\n---\n>').catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: PDF_ERROR_CODES.RichTextInvalid })
    expect(String((error as Error).message)).not.toContain('indentation')
  })
})
