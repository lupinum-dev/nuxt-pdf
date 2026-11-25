import { performance } from 'node:perf_hooks'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseRichTextHtml } from '../src/runtime/rich-text'
import { MAX_RICH_TEXT_LENGTH } from '../src/runtime/rich-text/limits'
import type { PdfRichBlock, PdfRichInline, PdfRichParagraph, PdfRichTableCell, PdfRichTextRun } from '../src/runtime/rich-text/types'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'

// Short builders for the expected models; each returns the literal node.
type Marks = Omit<PdfRichTextRun, 'type' | 'text'>
const t = (text: string, marks: Marks = {}): PdfRichTextRun => ({ type: 'text', text, ...marks })
const br: PdfRichInline = { type: 'break' }
const a = (href: string, ...children: PdfRichInline[]): PdfRichInline => ({ type: 'link', href, children })
const p = (...children: PdfRichInline[]): PdfRichParagraph => ({ type: 'paragraph', children })
const h = (level: 1 | 2 | 3 | 4 | 5 | 6, ...children: PdfRichInline[]): PdfRichBlock => ({ type: 'heading', level, children })
const ul = (...items: PdfRichBlock[][]): PdfRichBlock => ({ type: 'list', ordered: false, items })
const ol = (...items: PdfRichBlock[][]): PdfRichBlock => ({ type: 'list', ordered: true, items })
const quote = (...children: PdfRichBlock[]): PdfRichBlock => ({ type: 'quote', children })
/** A table cell with one paragraph (none without children). */
const td = (...children: PdfRichInline[]): PdfRichTableCell => ({ children: children.length === 0 ? [] : [{ type: 'paragraph', children }] })
const code = (text: string, language?: string): PdfRichBlock => language === undefined ? { type: 'code', text } : { type: 'code', text, language }
const rule: PdfRichBlock = { type: 'rule' }

const errorOf = (run: () => unknown): NuxtPdfError => {
  try {
    run()
  }
  catch (error) {
    if (error instanceof NuxtPdfError) return error
    throw error
  }
  throw new Error('expected a PDF_RICH_TEXT_INVALID error')
}

describe('parseRichTextHtml: tags', () => {
  // Catches a tag on the allowlist that maps to the wrong node or loses its content.
  it.each<[string, string, PdfRichBlock[]]>([
    ['p', '<p>One</p><p>Two</p>', [p(t('One')), p(t('Two'))]],
    ['h1 to h6', '<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h5>E</h5><h6>F</h6>', [h(1, t('A')), h(2, t('B')), h(3, t('C')), h(4, t('D')), h(5, t('E')), h(6, t('F'))]],
    ['strong and b', '<p><strong>a</strong><b>b</b></p>', [p(t('ab', { bold: true }))]],
    ['em and i', '<p><em>a</em><i>b</i></p>', [p(t('ab', { italic: true }))]],
    ['u', '<p><u>a</u></p>', [p(t('a', { underline: true }))]],
    ['s, del and strike', '<p><s>a</s><del>b</del><strike>c</strike></p>', [p(t('abc', { strike: true }))]],
    ['code', '<p>run <code>npm test</code></p>', [p(t('run '), t('npm test', { code: true }))]],
    ['nested marks', '<p><strong>a <em>b</em></strong></p>', [p(t('a ', { bold: true }), t('b', { bold: true, italic: true }))]],
    // Catches sup and sub dropped to the baseline (before N1b), a raised run
    // joined to the bold text before it, or a nested place that wins over the outer one.
    ['sup and sub', '<p>m<sup>2</sup> and CO<sub>2</sub></p>', [p(t('m'), t('2', { verticalAlign: 'super' }), t(' and CO'), t('2', { verticalAlign: 'sub' }))]],
    ['sup with a mark, and sub inside sup keeps the outer place', '<p><b>x<sup>2</sup></b> a<sup>b<sub>i</sub></sup></p>', [p(t('x', { bold: true }), t('2', { bold: true, verticalAlign: 'super' }), t(' a'), t('bi', { verticalAlign: 'super' }))]],
    ['a', '<p>See <a href="https://example.test/a?b=1&amp;c=2">the page</a>.</p>', [p(t('See '), a('https://example.test/a?b=1&c=2', t('the page')), t('.'))]],
    ['br', '<p>one<br>two<br/>three</p>', [p(t('one'), br, t('two'), br, t('three'))]],
    ['span is transparent', '<p><span class="x">a</span><span>b</span></p>', [p(t('ab'))]],
    ['ul', '<ul><li>a</li><li>b</li></ul>', [ul([p(t('a'))], [p(t('b'))])]],
    ['ol', '<ol><li>a</li></ol>', [ol([p(t('a'))])]],
    ['ol start', '<ol start="4"><li>a</li></ol>', [{ type: 'list', ordered: true, start: 4, items: [[p(t('a'))]] }]],
    ['ol start 0', '<ol start="0"><li>a</li></ol>', [{ type: 'list', ordered: true, start: 0, items: [[p(t('a'))]] }]],
    ['ol start 1 is the default', '<ol start="1"><li>a</li></ol>', [ol([p(t('a'))])]],
    ['ol start that is not a whole number', '<ol start="-2"><li>a</li></ol><ol start="2.5"><li>b</li></ol><ol start="x"><li>c</li></ol>', [ol([p(t('a'))]), ol([p(t('b'))]), ol([p(t('c'))])]],
    ['ul ignores start', '<ul start="3"><li>a</li></ul>', [ul([p(t('a'))])]],
    ['blockquote', '<blockquote><p>a</p><p>b</p></blockquote>', [quote(p(t('a')), p(t('b')))]],
    ['blockquote with loose text', '<blockquote>a</blockquote>', [quote(p(t('a')))]],
    ['pre keeps spaces and line breaks', '<pre>\n  if (a) {\n    b()\n  }\n</pre>', [code('  if (a) {\n    b()\n  }')]],
    ['pre ignores tags inside, a br is a line break', '<pre><code class="language-js"><b>x</b> = 1<br>y</code></pre>', [code('x = 1\ny', 'js')]],
    // Catches a language lost, or read from a class that is not a language class.
    ['the language of a code block comes from a language- class', '<pre><code class="hljs language-python">a</code></pre><pre><code class="language-">b</code></pre>', [code('a', 'python'), code('b')]],
    ['hr', '<p>a</p><hr><p>b</p>', [p(t('a')), rule, p(t('b'))]],
    ['div with inline content is a paragraph', '<div>a <b>b</b></div>', [p(t('a '), t('b', { bold: true }))]],
    ['div with blocks is transparent', '<div><h2>A</h2><div><p>b</p>c</div></div>', [h(2, t('A')), p(t('b')), p(t('c'))]],
    // Catches the list of notes printed as text, the reference's own `1`
    // kept, a second body for a repeat, an unused note or the back link printed.
    ['the footnote markup of a Markdown renderer', '<p>Peat<sup class="footnote-ref"><a href="#fn1" id="fnref1">1</a></sup> and bogs<sup class="footnote-ref"><a href="#fn1">1</a></sup>.</p><section class="footnotes"><ol><li id="fn1"><p>Source, <em>2024</em>. <a href="#fnref1" class="footnote-backref">↩</a></p></li><li id="fn2">Unused.</li></ol></section>', [
      p(t('Peat'), { type: 'footnote', key: 'fn1', children: [t('Source, '), t('2024', { italic: true }), t('.')] }, t(' and bogs'), { type: 'footnote', key: 'fn1' }, t('.')),
    ]],
    // A link inside a note is a link, also to another note: a note has no notes.
    ['a note that links to another note', '<p>A<sup class="footnote-ref"><a href="#fn1">1</a></sup> B<sup class="footnote-ref"><a href="#fn2">2</a></sup></p><section class="footnotes"><ol><li id="fn1">See <a href="#fn2">note 2</a>.</li><li id="fn2">Two.</li></ol></section>', [
      p(t('A'), { type: 'footnote', key: 'fn1', children: [t('See note 2.')] }, t(' B'), { type: 'footnote', key: 'fn2', children: [t('Two.')] }),
    ]],
    ['tags in any case', '<P>a <STRONG>b</STRONG> <A HREF="https://example.test">c</A></P>', [p(t('a '), t('b', { bold: true }), t(' '), a('https://example.test', t('c')))]],
  ])('%s', (_name, html, expected) => {
    expect(parseRichTextHtml(html)).toEqual(expected)
  })
})

describe('parseRichTextHtml: dropped content', () => {
  // Catches markup that is code or metadata printing as article text.
  it.each<[string, string, PdfRichBlock[]]>([
    ['script with markup inside', '<p>a</p><script>document.write("<p>x</p>")</script><p>b</p>', [p(t('a')), p(t('b'))]],
    ['script end tag in any case', '<SCRIPT>x</ScRiPt ><p>b</p>', [p(t('b'))]],
    ['style', '<style>p { color: red }</style><p>b</p>', [p(t('b'))]],
    ['iframe', '<p>a<iframe src="https://example.test">fallback</iframe>b</p>', [p(t('ab'))]],
    ['object', '<object data="x"><p>fallback</p></object><p>b</p>', [p(t('b'))]],
    ['template', '<template><p>x</p></template><p>b</p>', [p(t('b'))]],
    ['comment', '<p>a<!-- note <p>x</p> -->b</p>', [p(t('ab'))]],
    ['unclosed comment', '<p>a</p><!-- the rest', [p(t('a'))]],
    ['doctype and processing instruction', '<!DOCTYPE html><?xml version="1.0"?><p>a</p>', [p(t('a'))]],
    ['head and title of a whole document', '<html><head><title>Page</title><meta charset="utf-8"></head><body><p>a</p></body></html>', [p(t('a'))]],
    ['svg and math', '<p>a<svg><text>x</text></svg><math><mi>y</mi></math>b</p>', [p(t('ab'))]],
    ['an unknown tag keeps its text', '<p><font color="red">a</font><mark>b</mark><custom-tag>c</custom-tag></p>', [p(t('abc'))]],
    // Catches the words of two cells or sections running together into one.
    // Catches a table flattened to paragraphs, a span, alignment, row header
    // or caption lost, tfoot rows printed before the body, or col widths ignored.
    ['a table with a header, spans, alignment, a caption, col widths and tfoot', '<table><caption>Peat <b>stocks</b></caption><colgroup><col style="width: 30%"><col width="70%"></colgroup>'
    + '<thead><tr><th>Site</th><th align="right">t/ha</th></tr></thead><tfoot><tr><td>Sum</td><td>9</td></tr></tfoot>'
    + '<tbody><tr><th rowspan="2">North</th><td style="text-align: center">4</td></tr><tr><td>5</td></tr><tr><td colspan="2"><p>One.</p><p>Two.</p></td></tr></tbody></table>', [{
      type: 'table',
      columns: [30, 70],
      header: [td(t('Site')), { ...td(t('t/ha')), align: 'right' }],
      rows: [
        [{ ...td(t('North')), rowspan: 2, header: true }, { ...td(t('4')), align: 'center' }],
        [td(t('5'))],
        [{ children: [{ type: 'paragraph', children: [t('One.')] }, { type: 'paragraph', children: [t('Two.')] }], colspan: 2 }],
        [td(t('Sum')), td(t('9'))],
      ],
      caption: [t('Peat '), t('stocks', { bold: true })],
    }]],
    // Catches a th beside td cells read as a column header, and a first row of
    // th cells only (no thead, as editors write it) read as row headers.
    ['a table without thead: a th beside td is a row header, a first row of th only is the header', '<table><tr><th>a</th><td>b <b>c</b></td></tr><tr><td>d</td></tr></table><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td></td></tr></table>', [
      { type: 'table', rows: [[{ ...td(t('a')), header: true }, td(t('b '), t('c', { bold: true }))], [td(t('d'))]] },
      { type: 'table', header: [td(t('A')), td(t('B'))], rows: [[td(t('1')), td()]] },
    ]],
    // Catches text outside the cells lost, or an invalid model from spans a
    // browser draws cut: a rowspan past the last row, a colspan into a rowspan.
    ['content outside the cells before the table, spans cut to what fits', '<table>loose<tr><td>a</td><td rowspan="5">b</td></tr><tr><td colspan="2">c</td></tr></table>', [
      p(t('loose')),
      { type: 'table', rows: [[td(t('a')), { ...td(t('b')), rowspan: 2 }], [td(t('c'))]] },
    ]],
    // Catches col widths taken when only some columns have one (TipTap writes
    // min-width for the others), a colspan that is not a number kept, and col
    // widths taken as absolute widths instead of the proportions of the columns.
    ['col widths as shares, only when every column has one', '<table><colgroup><col style="width: 120px"><col style="min-width: 25px"></colgroup><tr><td colspan="x">a</td><td>b</td></tr></table><table><col style="width: 120px"><col width="80"><tr><td>a</td><td>b</td></tr></table>', [
      { type: 'table', rows: [[td(t('a')), td(t('b'))]] },
      { type: 'table', columns: [120, 80], rows: [[td(t('a')), td(t('b'))]] },
    ]],
    ['a section, a definition list and a caption hold blocks', '<section>a<p>b</p></section><dl><dt>c</dt><dd>d</dd></dl><figure><figcaption>e</figcaption></figure>', [p(t('a')), p(t('b')), p(t('c')), p(t('d')), p(t('e'))]],
    ['every attribute but href and start is ignored', '<p style="color:red" onclick="x()"><b style="font-weight:normal">a</b></p>', [p(t('a', { bold: true }))]],
  ])('%s', (_name, html, expected) => {
    expect(parseRichTextHtml(html)).toEqual(expected)
  })
})

describe('parseRichTextHtml: entities', () => {
  // Catches a reference printed as written, decoded twice, or decoded into an invalid code point.
  it.each<[string, string, string]>([
    ['the XML set', '&amp; &lt; &gt; &quot; &apos;', '& < > " \''],
    ['Latin-1', '&eacute;&Auml;&szlig;&copy;&frac12;', 'éÄß©½'],
    ['typographic', '&ndash;&mdash;&lsquo;&rsquo;&ldquo;&rdquo;&hellip;&euro;&bull;&trade;', '–—‘’“”…€•™'],
    ['decimal', '&#65;&#228;&#8364;', 'Aä€'],
    ['hexadecimal', '&#x41;&#XE4;&#x1F600;', 'Aä😀'],
    ['Windows-1252 numbers', '&#150;&#147;&#148;&#128;', '–“”€'],
    ['invalid code points', '&#0;&#xD800;&#x110000;', '���'],
    ['an unknown name stays', '&bogus; &amp', '&bogus; &amp'],
    ['decoded once', '&amp;amp;', '&amp;'],
    ['nbsp is not collapsed', 'a&nbsp;&nbsp;b', 'a  b'],
  ])('%s', (_name, html, text) => {
    expect(parseRichTextHtml(`<p>${html}</p>`)).toEqual([p(t(text))])
  })
})

describe('parseRichTextHtml: link targets', () => {
  // Catches a script or local target becoming a clickable link.
  it.each([
    ['https://example.test/x', 'https://example.test/x'],
    ['http://example.test', 'http://example.test'],
    ['mailto:office@example.test', 'mailto:office@example.test'],
    ['tel:+431234567', 'tel:+431234567'],
    ['  HTTPS://example.test  ', 'HTTPS://example.test'],
  ])('keeps %j', (href, kept) => {
    expect(parseRichTextHtml(`<p><a href="${href}">x</a></p>`)).toEqual([p(a(kept, t('x')))])
  })

  it.each([
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    'java&#9;script:alert(1)',
    'data:text/html,x',
    'vbscript:x',
    'file:///etc/passwd',
    '/relative/path',
    '#section',
    'https:',
    'https://one.example/&#1;',
    'https://one.example/&#10;path',
    '',
  ])('drops the link and keeps the text for %j', (href) => {
    expect(parseRichTextHtml(`<p><a href="${href}">x</a></p>`)).toEqual([p(t('x'))])
  })

  it('drops a link without href', () => {
    expect(parseRichTextHtml('<p><a name="top">x</a></p>')).toEqual([p(t('x'))])
  })
})

describe('parseRichTextHtml: whitespace', () => {
  // Catches source formatting (indentation, line breaks) printing as spaces or lost words.
  it.each<[string, string, PdfRichBlock[]]>([
    ['runs collapse to one space', '<p>a  \n\t b</p>', [p(t('a b'))]],
    ['trimmed at the block edges', '<p>\n  a\n</p>', [p(t('a'))]],
    ['one space between inline elements', '<p><b>a</b> <i>b</i></p>', [p(t('a', { bold: true }), t(' '), t('b', { italic: true }))]],
    ['no double space across elements', '<p>a <b> b</b></p>', [p(t('a '), t('b', { bold: true }))]],
    ['no space next to a line break', '<p>a <br> b</p>', [p(t('a'), br, t('b'))]],
    ['a last line break adds no line', '<p>a<br></p>', [p(t('a'))]],
    ['two last line breaks add one empty line', '<p>a<br><br></p>', [p(t('a'), br)]],
    ['formatting between blocks is not text', '<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>\n<p>c</p>\n', [ul([p(t('a'))], [p(t('b'))]), p(t('c'))]],
    ['CR LF reads as a line break in pre', '<pre>a\r\nb\rc</pre>', [code('a\nb\nc')]],
  ])('%s', (_name, html, expected) => {
    expect(parseRichTextHtml(html)).toEqual(expected)
  })
})

describe('parseRichTextHtml: structure and malformed markup', () => {
  // Catches a crash, lost text or text in the wrong block on markup that editors and hand edits produce.
  it.each<[string, string, PdfRichBlock[]]>([
    ['text in the root becomes a paragraph', 'a <b>b</b><p>c</p>d', [p(t('a '), t('b', { bold: true })), p(t('c')), p(t('d'))]],
    // An unknown tag that is a name on Object.prototype was read as a heading without a level.
    ['a tag named like an object member is an unknown tag', '<p>a<constructor>b</constructor><valueof>c</valueof></p>', [p(t('abc'))]],
    ['text in li becomes a paragraph', '<ul><li>a <b>b</b></li></ul>', [ul([p(t('a '), t('b', { bold: true }))])]],
    ['p inside li (TipTap)', '<ul><li><p>a</p></li><li><p>b</p><p>c</p></li></ul>', [ul([p(t('a'))], [p(t('b')), p(t('c'))])]],
    ['a nested list inside li', '<ul><li>a<ol><li>b</li></ol>c</li></ul>', [ul([p(t('a')), ol([p(t('b'))]), p(t('c'))])]],
    ['li outside a list keeps its content without a marker', '<li>a</li><li>b</li>', [p(t('a')), p(t('b'))]],
    ['other content in a list joins the item before it', '<ul><li>a</li><p>b</p></ul><ol><p>c</p><li>d</li></ol>', [ul([p(t('a')), p(t('b'))]), ol([p(t('c'))], [p(t('d'))])]],
    ['an empty list is dropped', '<ul></ul><ul> </ul><p>a</p>', [p(t('a'))]],
    ['an empty item stays (it shows a marker)', '<ul><li></li><li>a</li></ul>', [ul([], [p(t('a'))])]],
    ['marks across a link', '<p><b>a <a href="https://example.test">b <i>c</i></a> d</b></p>', [p(t('a ', { bold: true }), a('https://example.test', t('b ', { bold: true }), t('c', { bold: true, italic: true })), t(' d', { bold: true }))]],
    ['two links in a row stay two', '<p><a href="https://example.test">a</a><a href="https://example.test">b</a></p>', [p(a('https://example.test', t('a')), a('https://example.test', t('b')))]],
    ['a link inside a link joins the outer link', '<p><a href="https://one.example">a <a href="https://two.example">b</a></a></p>', [p(a('https://one.example', t('a b')))]],
    ['a block inside an inline tag ends the paragraph and keeps the marks', '<b>a<p>b</p>c</b>', [p(t('a', { bold: true })), p(t('b', { bold: true })), p(t('c', { bold: true }))]],
    // A browser opens the mark again after the paragraph (HTML's list of
    // active formatting elements); this parser does not, so the mark ends.
    ['a p inside a mark inside a p closes both', '<p>a<b>b<p>c</p></b></p>', [p(t('a'), t('b', { bold: true })), p(t('c'))]],
    ['a heading inside a link is a heading with a link', '<a href="https://example.test"><h2>Title</h2></a>', [h(2, a('https://example.test', t('Title')))]],
    ['a block inside a heading joins the heading line', '<h2>a <p>b</p></h2>', [h(2, t('a b'))]],
    ['a heading with no text is dropped', '<h2> </h2><h3><br></h3><p>a</p>', [h(3, br), p(t('a'))]],
    ['unclosed p', '<p>a<p>b', [p(t('a')), p(t('b'))]],
    ['a block closes an open p', '<p>a<ul><li>b</li></ul>c', [p(t('a')), ul([p(t('b'))]), p(t('c'))]],
    ['unclosed li', '<ul><li>a<li>b</ul>', [ul([p(t('a'))], [p(t('b'))])]],
    ['wrongly nested marks', '<p><b>a<i>b</b>c</i>d</p>', [p(t('a', { bold: true }), t('b', { bold: true, italic: true }), t('cd'))]],
    ['an end tag with no open element is ignored', '</p></div><p>a</b></p>', [p(t('a'))]],
    ['</br> is a line break', '<p>a</br>b</p>', [p(t('a'), br, t('b'))]],
    ['input that ends inside a tag', '<p>a<b class="x', [p(t('a'))]],
    ['an unclosed attribute quote runs to the end', '<p>a<a href="https://example.test>b</a> c</p>', [p(t('a'))]],
    ['a < that starts no tag is text', '<p>1 < 2 and 3 <= 4, <<b>x</b></p>', [p(t('1 < 2 and 3 <= 4, <'), t('x', { bold: true }))]],
    ['</ and </> are skipped', '<p>a</ b>c</>d</p>', [p(t('acd'))]],
    ['a heading closes an open heading', '<h2>a<h3>b</h3>', [h(2, t('a')), h(3, t('b'))]],
    ['the first of a repeated attribute wins', '<a href="https://one.example" href="javascript:x">a</a>', [p(a('https://one.example', t('a')))]],
    ['unquoted attribute values', '<a href=https://example.test/x>a</a>', [p(a('https://example.test/x', t('a')))]],
    ['empty paragraphs are dropped (a browser shows no line)', '<p></p><p> </p><p>a</p>', [p(t('a'))]],
    ['a paragraph with a line break is an empty line', '<p><br></p>', [p(br)]],
    ['empty input', '', []],
  ])('%s', (_name, html, expected) => {
    expect(parseRichTextHtml(html)).toEqual(expected)
  })
})

describe('parseRichTextHtml: editor output', () => {
  // Hand-written in the shape each editor documents for its HTML export
  // (invented text), so a change in how we read one editor shows here.
  const article = [
    h(2, t('Spring cleanup')),
    p(t('Volunteers meet at the '), t('river path', { bold: true }), t(' on '), t('Saturday', { italic: true }), t('. Read the '), a('https://example.test/plan', t('plan')), t('.')),
    ul([p(t('Gloves'))], [p(t('Bags'))]),
  ]

  it('TipTap (getHTML)', () => {
    const html = '<h2>Spring cleanup</h2><p>Volunteers meet at the <strong>river path</strong> on <em>Saturday</em>. Read the <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.test/plan">plan</a>.</p><ul><li><p>Gloves</p></li><li><p>Bags</p></li></ul><p></p><blockquote><p>Bring water.</p></blockquote><pre><code class="language-text">8:00  meet\n8:15  start</code></pre><hr>'
    expect(parseRichTextHtml(html)).toEqual([...article, quote(p(t('Bring water.'))), code('8:00  meet\n8:15  start', 'text'), rule])
  })

  it('Lexical ($generateHtmlFromNodes)', () => {
    const html = '<h2 class="editor-heading-h2" dir="ltr"><span style="white-space: pre-wrap;">Spring cleanup</span></h2><p class="editor-paragraph" dir="ltr"><span style="white-space: pre-wrap;">Volunteers meet at the </span><b><strong class="editor-text-bold" style="white-space: pre-wrap;">river path</strong></b><span style="white-space: pre-wrap;"> on </span><i><em class="editor-text-italic" style="white-space: pre-wrap;">Saturday</em></i><span style="white-space: pre-wrap;">. Read the </span><a href="https://example.test/plan" class="editor-link"><span style="white-space: pre-wrap;">plan</span></a><span style="white-space: pre-wrap;">.</span></p><ul class="editor-list-ul"><li value="1" class="editor-listitem"><span style="white-space: pre-wrap;">Gloves</span></li><li value="2" class="editor-listitem"><span style="white-space: pre-wrap;">Bags</span></li></ul><p class="editor-paragraph"><br></p>'
    expect(parseRichTextHtml(html)).toEqual([...article, p(br)])
  })

  it('Quill (root innerHTML)', () => {
    const html = '<h2>Spring cleanup</h2><p>Volunteers meet at the <strong>river path</strong> on <em>Saturday</em>. Read the <a href="https://example.test/plan" rel="noopener noreferrer" target="_blank">plan</a>.</p><ul><li>Gloves</li><li>Bags</li></ul><p><br></p><p><u>Note</u>: <s>Sunday</s> Saturday.</p><pre class="ql-syntax" spellcheck="false">8:00  meet\n</pre>'
    expect(parseRichTextHtml(html)).toEqual([...article, p(br), p(t('Note', { underline: true }), t(': '), t('Sunday', { strike: true }), t(' Saturday.')), code('8:00  meet')])
  })
})

describe('parseRichTextHtml: limits and input', () => {
  // Catches unbounded input reaching the tree or the render.
  it('fails over the length limit, naming the limit and the length', () => {
    const error = errorOf(() => parseRichTextHtml('a'.repeat(MAX_RICH_TEXT_LENGTH + 1)))
    expect(error.code).toBe(PDF_ERROR_CODES.RichTextInvalid)
    expect(error.issues).toEqual([{ rule: 'PDF-RICH-LIMIT', path: 'html', message: 'the HTML has 1000001 characters, over the limit of 1000000' }])
  })

  it('fails over the depth limit', () => {
    const error = errorOf(() => parseRichTextHtml('<b>'.repeat(40)))
    expect(error.issues).toEqual([{ rule: 'PDF-RICH-LIMIT', path: 'html', message: 'the HTML nests elements 33 deep, over the limit of 32' }])
  })

  it('takes nesting up to the depth limit', () => {
    expect(parseRichTextHtml(`${'<span>'.repeat(31)}a`)).toEqual([p(t('a'))])
  })

  it('fails over the node limit', () => {
    const error = errorOf(() => parseRichTextHtml('<br>'.repeat(50_001)))
    expect(error.issues).toEqual([{ rule: 'PDF-RICH-LIMIT', path: 'html', message: 'the HTML has more than 50000 nodes (elements and texts), over the limit' }])
  })

  // Catches a reference whose note is missing that prints a stray raised `9`.
  // Catches a note whose paragraphs or list would be joined into one line.
  it.each([
    ['two paragraphs', '<li id="fn1"><p>One.</p><p>Two.</p></li>', 'p'],
    ['a list', '<li id="fn1">See: <ul><li>a</li></ul></li>', 'ul'],
  ])('fails on a note with %s', (_name, item, tag) => {
    const error = errorOf(() => parseRichTextHtml(`<p>a<sup class="footnote-ref"><a href="#fn1">1</a></sup></p><section class="footnotes"><ol>${item}</ol></section>`))
    expect(error.issues).toEqual([{ rule: 'PDF-RICH-NODE', path: 'html', message: `the footnote "fn1" holds <${tag}>, but a note is one paragraph of text. Write the note as one paragraph` }])
  })

  // Catches a footnote with an empty note (an invalid model) when the note
  // holds only its back link.
  it('fails on a note without text', () => {
    const error = errorOf(() => parseRichTextHtml('<p>a<sup class="footnote-ref"><a href="#fn1">1</a></sup></p><section class="footnotes"><ol><li id="fn1"><a href="#fnref1" class="footnote-backref">↩</a></li></ol></section>'))
    expect(error.issues).toEqual([{ rule: 'PDF-RICH-NODE', path: 'html', message: 'the footnote "fn1" has no text in its note. Write the note as text, such as "[^1]: The note."' }])
  })

  // Catches a table that would change without a word: a cell's list joined
  // into its text, a second header row that does not repeat, a header that
  // cannot repeat as one row, a note repeated on every page; and a table
  // over the column limit.
  it.each([
    ['a list in a cell', '<table><tr><td>a<ul><li>b</li></ul></td></tr></table>', 'PDF-RICH-NODE', 'a table cell holds a list, but a cell holds text and paragraphs only. Move it out of the table'],
    ['two header rows', '<table><thead><tr><th>a</th></tr><tr><th>b</th></tr></thead></table>', 'PDF-RICH-NODE', 'a table has 2 header rows, but its header is one row that repeats on every page. Put the other rows in the body (tbody)'],
    ['a header cell over two rows', '<table><thead><tr><th rowspan="2">a</th></tr></thead><tr><td>b</td></tr></table>', 'PDF-RICH-NODE', 'a table header cell spans rows, but the header is one row that repeats on every page'],
    ['a footnote in a header cell', '<table><thead><tr><th>a<sup class="footnote-ref"><a href="#fn1">1</a></sup></th></tr></thead></table><section class="footnotes"><ol><li id="fn1">Note.</li></ol></section>', 'PDF-RICH-NODE', 'a table header cell holds a footnote, but the header repeats on every page, and so would its note. Move the footnote into a body row or the text'],
    ['65 columns', '<table><tr><td colspan="65">a</td></tr></table>', 'PDF-RICH-LIMIT', 'a table has 65 columns, over the limit of 64'],
  ])('fails on a table with %s', (_name, html, rule, message) => {
    expect(errorOf(() => parseRichTextHtml(html)).issues).toEqual([{ rule, path: 'html', message }])
  })

  it('fails on a footnote reference without its note', () => {
    const error = errorOf(() => parseRichTextHtml('<p>a<sup class="footnote-ref"><a href="#fn9">9</a></sup></p>'))
    expect(error.issues).toEqual([{ rule: 'PDF-RICH-NODE', path: 'html', message: 'a footnote reference has no note: write its definition, such as "[^1]: The note."' }])
  })

  it('fails on input that is not a string, without echoing it', () => {
    const error = errorOf(() => parseRichTextHtml({ html: 'secret' } as never))
    expect(error.issues).toEqual([{ rule: 'PDF-RICH-NODE', path: 'html', message: 'expected a string, found an object' }])
  })
})

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const escapeText = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** The test serializer: the model as editor HTML, marks nested in one fixed order. */
const inlineHtml = (node: PdfRichInline): string => {
  if (node.type === 'break') return '<br>'
  if (node.type === 'footnote') throw new Error('the generator writes no footnotes')
  if (node.type === 'link') return `<a href="${node.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${node.children.map(inlineHtml).join('')}</a>`
  let html = escapeText(node.text)
  if (node.code) html = `<code>${html}</code>`
  if (node.strike) html = `<s>${html}</s>`
  if (node.underline) html = `<u>${html}</u>`
  if (node.italic) html = `<em>${html}</em>`
  if (node.bold) html = `<strong>${html}</strong>`
  return html
}
const blockHtml = (node: PdfRichBlock): string => {
  switch (node.type) {
    case 'paragraph': return `<p>${node.children.map(inlineHtml).join('')}</p>`
    case 'heading': return `<h${node.level}>${node.children.map(inlineHtml).join('')}</h${node.level}>`
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul'
      const start = node.start === undefined ? '' : ` start="${node.start}"`
      return `<${tag}${start}>${node.items.map(item => `<li>${item.map(blockHtml).join('')}</li>`).join('')}</${tag}>`
    }
    case 'quote': return `<blockquote>${node.children.map(blockHtml).join('')}</blockquote>`
    case 'code': return `<pre>${escapeText(node.text)}</pre>`
    case 'rule': return '<hr>'
    case 'table': {
      const cell = (item: PdfRichTableCell, tag: string): string =>
        `<${tag}${item.align === undefined ? '' : ` style="text-align: ${item.align}"`}>${item.children.map(blockHtml).join('')}</${tag}>`
      const caption = node.caption === undefined ? '' : `<caption>${node.caption.map(inlineHtml).join('')}</caption>`
      const head = node.header === undefined ? '' : `<thead><tr>${node.header.map(item => cell(item, 'th')).join('')}</tr></thead>`
      const rows = node.rows.map(row => `<tr>${row.map(item => cell(item, item.header ? 'th' : 'td')).join('')}</tr>`).join('')
      return `<table>${caption}${head}<tbody>${rows}</tbody></table>`
    }
    // HTML input never makes a component, and the generators below never write one or an image.
    case 'component':
    case 'image': return ''
  }
}

// Words with characters that need escaping or that HTML could misread.
const word = fc.constantFrom('river', 'Ärger', 'a&b', '1<2', 'x>y', '"quoted"', 'it\'s', 'née', '€5', 'a b', '&amp;', '<p>')
const words = fc.array(word, { minLength: 1, maxLength: 4 }).map(list => list.join(' '))
// Each mark present as `true` or left out, as the parser writes them.
const marks: fc.Arbitrary<Marks> = fc.record(
  { bold: fc.constant(true), italic: fc.constant(true), underline: fc.constant(true), strike: fc.constant(true), code: fc.constant(true) },
  { requiredKeys: [] },
)
const textRun = fc.tuple(words, marks).map(([text, set]) => t(text, set))

/** Joins neighbouring runs with the same marks, as the parser does: the model in its normal form. */
const normalRuns = (nodes: PdfRichInline[]): PdfRichInline[] => nodes.reduce<PdfRichInline[]>((joined, node) => {
  const previous = joined.at(-1)
  if (node.type === 'text' && previous?.type === 'text'
    && (['bold', 'italic', 'underline', 'strike', 'code'] as const).every(mark => previous[mark] === node[mark])) {
    joined[joined.length - 1] = { ...previous, text: previous.text + node.text }
    return joined
  }
  return [...joined, node]
}, [])

const link = fc.tuple(fc.constantFrom('https://example.test/a?b=1&c=2', 'mailto:office@example.test', 'tel:+1555'), fc.array(textRun, { minLength: 1, maxLength: 3 }))
  .map(([href, runs]): PdfRichInline => ({ type: 'link', href, children: normalRuns(runs) }))
// No line break last: a last line break adds no line, so it does not survive the round trip.
const inlines = fc.array(fc.oneof({ weight: 5, arbitrary: textRun }, { weight: 1, arbitrary: link }, { weight: 1, arbitrary: fc.constant(br) }), { minLength: 1, maxLength: 6 })
  .map(list => normalRuns(list))
  .filter(list => list.at(-1)?.type !== 'break')

// A table without spans: one to four columns, a header or none, a row header
// only as the first of several cells (a first row of th cells only is the header).
const tableCell = fc.tuple(fc.array(inlines, { maxLength: 2 }), fc.option(fc.constantFrom('left', 'center', 'right'), { nil: undefined }))
  .map(([paragraphs, align]): PdfRichTableCell => ({
    children: paragraphs.map(children => ({ type: 'paragraph', children })),
    ...(align === undefined ? {} : { align }),
  }))
const tableArbitrary = fc.integer({ min: 1, max: 4 }).chain(columns => fc.tuple(
  fc.option(fc.array(tableCell, { minLength: columns, maxLength: columns }), { nil: undefined }),
  fc.array(fc.tuple(fc.array(tableCell, { minLength: columns, maxLength: columns }), fc.boolean()), { minLength: 1, maxLength: 3 }),
  fc.option(inlines, { nil: undefined }),
)).map(([header, rows, caption]): PdfRichBlock => ({
  type: 'table',
  ...(header === undefined ? {} : { header }),
  rows: rows.map(([cells, rowHeader]) => rowHeader && cells.length > 1 ? [{ ...cells[0]!, header: true }, ...cells.slice(1)] : cells),
  ...(caption === undefined ? {} : { caption }),
}))

const { block: blockArbitrary } = fc.letrec<{ block: PdfRichBlock, blocks: PdfRichBlock[] }>(tie => ({
  block: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    inlines.map(children => p(...children)),
    fc.tuple(fc.constantFrom(1, 2, 3, 4, 5, 6), inlines).map(([level, children]) => h(level, ...children)),
    fc.tuple(fc.boolean(), fc.option(fc.integer({ min: 0, max: 200 }), { nil: undefined }), fc.array(tie('blocks'), { minLength: 1, maxLength: 3 }))
      .map(([ordered, start, items]): PdfRichBlock => ordered && start !== undefined && start !== 1
        ? { type: 'list', ordered, start, items }
        : { type: 'list', ordered, items }),
    fc.array(tie('block'), { minLength: 1, maxLength: 3 }).map(children => quote(...children)),
    fc.array(words, { minLength: 1, maxLength: 3 }).map(lines => code(lines.join('\n  '))),
    fc.constant(rule),
    tableArbitrary,
  ),
  blocks: fc.array(tie('block'), { maxLength: 3 }),
}))

// A fixed seed, so a run of the suite is red or green by the code and not by
// chance. To explore, change the seed and the number of runs of each property:
//   NUXT_PDF_RICH_TEXT_SEED=7 NUXT_PDF_RICH_TEXT_RUNS=3000 pnpm vitest run test/rich-text-html.test.ts
const SEED = Number(process.env.NUXT_PDF_RICH_TEXT_SEED) || 20_261_123
const RUNS = Number(process.env.NUXT_PDF_RICH_TEXT_RUNS) || undefined

describe('parseRichTextHtml: properties', () => {
  // Catches a tag, mark, entity or link the serializer writes and the parser reads differently.
  it(`reads back a model written as HTML (seed ${SEED})`, () => {
    fc.assert(fc.property(fc.array(blockArbitrary, { minLength: 1, maxLength: 5 }), (model) => {
      expect(parseRichTextHtml(model.map(blockHtml).join(''))).toEqual(model)
    }), { numRuns: RUNS ?? 400, seed: SEED })
  })

  // Catches an exception on markup no editor writes.
  it(`parses any string without an exception (seed ${SEED})`, () => {
    const markup = fc.string({ unit: fc.constantFrom('<', '>', '/', '!', '-', '?', '&', '#', ';', '"', '\'', '=', ' ', '\n', 'a', 'b', 'p', 'li', 'ul', 'x', 'script', 'pre', 'href', 'https:', '<a ', '</', '&amp', '&#x') })
    fc.assert(fc.property(fc.oneof(fc.string(), markup), (html) => {
      expect(Array.isArray(parseRichTextHtml(html))).toBe(true)
    }), { numRuns: RUNS ?? 2000, seed: SEED })
  })

  // Catches input that makes the parser slow (a pattern that backtracks or a quadratic join).
  it.each<[string, string]>([
    ['< repeated', '<'.repeat(MAX_RICH_TEXT_LENGTH)],
    ['&amp; repeated', '&amp;'.repeat(MAX_RICH_TEXT_LENGTH / 5)],
    ['& and letters without ;', `&${'a'.repeat(MAX_RICH_TEXT_LENGTH - 1)}`],
    ['&# repeated', '&#'.repeat(MAX_RICH_TEXT_LENGTH / 2)],
    ['nested tags', '<b>'.repeat(MAX_RICH_TEXT_LENGTH / 3)],
    ['paragraphs', '<p>'.repeat(MAX_RICH_TEXT_LENGTH / 3)],
    ['an unclosed attribute', `<a href="${'x'.repeat(MAX_RICH_TEXT_LENGTH - 10)}`],
    ['attributes without end', `<a ${'x='.repeat((MAX_RICH_TEXT_LENGTH - 3) / 2)}`],
    ['an unclosed comment', `<!--${'-'.repeat(MAX_RICH_TEXT_LENGTH - 4)}`],
    ['an unclosed script with end-tag starts', `<script>${'</scrip'.repeat((MAX_RICH_TEXT_LENGTH - 8) / 7)}`],
    ['words and spaces', 'a \n'.repeat(MAX_RICH_TEXT_LENGTH / 3)],
    ['spans and text', '<span>a</span> '.repeat(MAX_RICH_TEXT_LENGTH / 15)],
  ])('stays under 200 ms for %s at the length limit', (_name, html) => {
    const start = performance.now()
    try {
      parseRichTextHtml(html)
    }
    catch (error) {
      expect(error).toMatchObject({ code: PDF_ERROR_CODES.RichTextInvalid })
    }
    expect(performance.now() - start).toBeLessThan(200)
  })
})
