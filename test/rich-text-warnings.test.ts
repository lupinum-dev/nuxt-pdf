import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { PDF_SOURCE_PROP } from '../src/runtime/shared/template'
import { renderPreparedPdfTemplate } from '../src/test/render-template'

const { PdfDocument, PdfPage, PdfRichText, PdfView } = PDF_COMPONENTS

const render = async (content: () => VNode[]) => {
  const document = defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { size: 'A4' }, content)))
  return (await renderPreparedPdfTemplate(document, {}, {})).result.diagnostics.richTextWarnings
}

/** Each warning as [code, name, count]. */
const warningsOf = async (props: Record<string, unknown>) =>
  (await render(() => [h(PdfRichText, { brokenImages: 'placeholder', ...props })])).map(warning => [warning.code, warning.name, warning.count])

const Alert = defineComponent({ props: ['type'], setup: (_, { slots }) => () => h(PdfView, null, () => slots.default?.()) })

describe('rich text warnings', () => {
  // Catches rich text input that the PDF loses without a word: each kind of
  // drop or change gives one entry per name, with its count.
  it.each<{ label: string, props: Record<string, unknown>, expected: Array<[string, string, number]> }>([
    {
      label: 'links that print as plain text',
      props: { html: '<p><a href="/about">a</a> <a href="javascript:alert(1)">b</a> <a href="#top">c</a> <a href="/team">d</a> <a href="https://example.com"><img src="logo.png" alt="Logo"></a></p>' },
      expected: [
        ['PDF_RICH_TEXT_LINK_DROPPED', 'relative', 2],
        ['PDF_RICH_TEXT_LINK_DROPPED', 'javascript:', 1],
        ['PDF_RICH_TEXT_LINK_DROPPED', '#', 1],
        ['PDF_RICH_TEXT_LINK_DROPPED', 'image', 1],
      ],
    },
    {
      label: 'attributes the PDF does not read, data-* grouped and id never',
      props: { html: '<p style="color: red" class="lead" data-a="1" data-b="2" id="intro" title="Intro">x</p><p style="color: blue">y</p><table><tr><td style="text-align: right">1</td></tr></table>' },
      expected: [
        ['PDF_RICH_TEXT_ATTRIBUTE_DROPPED', 'style', 2],
        ['PDF_RICH_TEXT_ATTRIBUTE_DROPPED', 'class', 1],
        ['PDF_RICH_TEXT_ATTRIBUTE_DROPPED', 'data-*', 2],
        ['PDF_RICH_TEXT_ATTRIBUTE_DROPPED', 'title', 1],
      ],
    },
    {
      label: 'tags dropped with their content and tags off the allowlist',
      props: { html: '<p>a<script>alert(1)</script><iframe src="https://example.com"></iframe><font color="red">b</font><mark>c</mark></p>' },
      expected: [
        ['PDF_RICH_TEXT_TAG_DROPPED', 'script', 1],
        ['PDF_RICH_TEXT_TAG_DROPPED', 'iframe', 1],
        ['PDF_RICH_TEXT_TAG_UNKNOWN', 'font', 1],
        ['PDF_RICH_TEXT_ATTRIBUTE_DROPPED', 'color', 1],
        ['PDF_RICH_TEXT_TAG_UNKNOWN', 'mark', 1],
      ],
    },
    {
      label: 'values cut or left out',
      props: { html: `<img src=""><img src="logo.png" alt="${'a'.repeat(1001)}" width="100%"><ol start="x"><li>a</li></ol><table><tr><td colspan="wide">a</td><td rowspan="3">b</td></tr></table>` },
      expected: [
        ['PDF_RICH_TEXT_VALUE_CHANGED', 'src', 1],
        ['PDF_RICH_TEXT_VALUE_CHANGED', 'alt', 1],
        ['PDF_RICH_TEXT_VALUE_CHANGED', 'width', 1],
        ['PDF_RICH_TEXT_VALUE_CHANGED', 'start', 1],
        ['PDF_RICH_TEXT_VALUE_CHANGED', 'colspan', 1],
        ['PDF_RICH_TEXT_VALUE_CHANGED', 'rowspan', 1],
      ],
    },
    {
      label: 'content components and their props',
      props: {
        comark: { nodes: [
          ['alert', { 'type': 'info', 'title': 'Note', 'class': 'wide', ':count': '{"x":' }, ['p', {}, 'Hi']],
          ['p', {}, 'Text ', ['alert', {}, 'inline']],
          ['note', {}, ['p', {}, 'Kept']],
        ] },
        components: { alert: Alert },
      },
      expected: [
        ['PDF_RICH_TEXT_ATTRIBUTE_DROPPED', 'class', 1],
        ['PDF_RICH_TEXT_COMPONENT_DROPPED', 'alert', 1],
        ['PDF_RICH_TEXT_COMPONENT_DROPPED', 'note', 1],
        ['PDF_RICH_TEXT_PROP_DROPPED', 'alert.title', 1],
        ['PDF_RICH_TEXT_PROP_DROPPED', 'alert.count', 1],
      ],
    },
  ])('reports $label', async ({ props, expected }) => {
    expect(await warningsOf(props)).toEqual(expect.arrayContaining(expected))
    expect(await warningsOf(props)).toHaveLength(expected.length)
  })

  // Catches warnings that flood (one entry per element) or that put content
  // into production diagnostics: entries merge over the render, and the
  // snippet comes only with a source position (development builds).
  it('merges entries over the render and gives the snippet only with a source position', async () => {
    const html = '<p style="color: red">a</p>'
    const developed = await render(() => [
      h(PdfRichText, { html, [PDF_SOURCE_PROP]: 'pdfs/post.vue:4:3' }),
      h(PdfRichText, { html, [PDF_SOURCE_PROP]: 'pdfs/post.vue:5:3' }),
    ])
    const produced = await render(() => [h(PdfRichText, { html })])

    expect(developed).toEqual([{
      code: 'PDF_RICH_TEXT_ATTRIBUTE_DROPPED',
      name: 'style',
      message: 'Inline styles do not reach the PDF. Style the elements with the "styles" prop of PdfRichText.',
      count: 2,
      snippet: 'style="color: red"',
      source: { file: 'pdfs/post.vue', line: 4, column: 3 },
    }])
    expect(produced).toEqual([{ code: 'PDF_RICH_TEXT_ATTRIBUTE_DROPPED', name: 'style', message: developed[0]!.message, count: 1 }])
  })

  // Catches warnings for what the PDF keeps: plain editor HTML gives none.
  it('gives no warning for editor HTML that the PDF keeps whole', async () => {
    expect(await warningsOf({ html: '<h2>Title</h2><p>Text <strong>bold</strong> <em>it</em> <a href="https://example.com">link</a><br>next</p><ul><li><p>a</p></li></ul><ol start="3"><li>b</li></ol><blockquote><p>q</p></blockquote><pre><code class="language-ts">x</code></pre><hr>' })).toEqual([])
  })
})
