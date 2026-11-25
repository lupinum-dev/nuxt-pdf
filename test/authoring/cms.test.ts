import { fileURLToPath } from 'node:url'
import { parseRichTextMarkdown } from '@lupinum/nuxt-pdf/server'
import { describe, expect, it } from 'vitest'
import { expectPdf, renderPdfSfc, type RenderPdfSfcOptions } from '../../src/test/index'

const template = fileURLToPath(new URL('./pdfs/cms.vue', import.meta.url))

const fonts: RenderPdfSfcOptions['fonts'] = [
  { family: 'Lora', src: 'Lora-400.ttf', fontWeight: 400 },
  { family: 'Lora', src: 'Lora-400-italic.ttf', fontWeight: 400, fontStyle: 'italic' },
  { family: 'Lora', src: 'Lora-700.ttf', fontWeight: 700 },
]

const html = `
<h1>Field notes</h1>
<p>The <strong>north</strong> site is <em>drier</em> than expected. Read the
<a href="https://example.com/notes">full notes</a> or write to
<a href="mailto:team@example.com">the team</a>.</p>
<h2>Sites</h2>
<ul><li>North</li><li>South</li></ul>
<table>
  <thead><tr><th>Site</th><th>Carbon (t/ha)</th></tr></thead>
  <tbody><tr><td>North</td><td>420</td></tr><tr><td>South</td><td>380</td></tr></tbody>
</table>
<img src="logo.png" alt="A snow-covered peak" width="160">
<p>Two links the docs say are dropped: <a href="/internal/page">a relative link</a>
and <a href="javascript:alert(1)">a script link</a>.</p>
`

const markdown = `# Field notes

The **north** site is *drier* than expected. Read the [full notes](https://example.com/notes)
or write to [the team](mailto:team@example.com).

## Sites

- North
- South

| Site  | Carbon (t/ha) |
| :---- | ------------: |
| North |           420 |
| South |           380 |

![A snow-covered peak](logo.png)

Two links the docs say are dropped: [a relative link](/internal/page) and [a script link](javascript:alert(1)).
`

describe('cms.vue with editor HTML', () => {
  it('prints headings, list, table, image and the two allowed links', async () => {
    const { parsed, result, bytes } = await renderPdfSfc(template, { html }, { fonts })

    expectPdf(parsed).toHavePageCount(1)
    // Catches a creationDate that is ignored: the same document and date must give the same bytes.
    const again = await renderPdfSfc(template, { html }, { fonts })
    expect(Buffer.from(again.bytes).equals(Buffer.from(bytes))).toBe(true)
    // Catches blocks being dropped by the HTML adapter.
    expectPdf(parsed)
      .toContainText('Field notes')
      .toContainText('Sites')
      .toContainText('The north site is drier than expected')
      .toContainText('South')
      .toContainText('Carbon (t/ha)')
      .toContainText('420')

    // Catches `bookmarks` not producing a flat outline entry for each heading.
    expectPdf(parsed).toHaveOutline([{ title: 'Field notes' }, { title: 'Sites' }])

    // Catches the image from pdfs/assets being refused or replaced by a placeholder.
    expect(result.diagnostics.imageWarnings).toEqual([])
    expect(Buffer.from(bytes).toString('latin1')).toContain('/Subtype /Image')

    // Catches the allowed links losing their target.
    expectPdf(parsed)
      .toHaveLink({ url: 'https://example.com/notes' })
      .toHaveLink({ url: 'mailto:team@example.com' })
  })

  it('keeps the text of a dropped link and drops its target', async () => {
    const { parsed } = await renderPdfSfc(template, { html }, { fonts })

    // Catches a dropped link that also takes its text with it.
    expectPdf(parsed).toContainText('a relative link').toContainText('a script link')
    // Catches a relative or javascript: link surviving as an annotation: only the two absolute links remain (a link that wraps has one annotation per line, hence the Set).
    expect([...new Set(parsed.links.map(link => link.url))].sort()).toEqual(['https://example.com/notes', 'mailto:team@example.com'])
  })

  it('prints a placeholder and a warning for an image that cannot load', async () => {
    const { parsed, result } = await renderPdfSfc(template, { html: '<p>Before</p><img src="missing.png" alt="Lost photo">' }, { fonts })

    // Catches a render that fails for an editor's broken image (the default is a placeholder).
    expectPdf(parsed).toContainText('Lost photo')
    // Catches the warning being missing: a silent placeholder hides the problem from the author.
    expect(result.diagnostics.imageWarnings).toMatchObject([{ code: 'PDF_RICH_TEXT_IMAGE_REPLACED' }])
  })
})

describe('cms.vue with Markdown', () => {
  it('prints the same blocks from a model that comark parsed', async () => {
    const content = await parseRichTextMarkdown(markdown)
    const { parsed, result, bytes } = await renderPdfSfc(template, { content }, { fonts })

    expectPdf(parsed).toHavePageCount(1)
    // Catches Markdown syntax leaking into the page (the heading marker, the table pipes or the list dash).
    const text = parsed.pages[0]!.text
    expect(text).not.toMatch(/[#|]|\*\*/)

    expectPdf(parsed)
      .toContainText('Field notes')
      .toContainText('The north site is drier than expected')
      .toContainText('Carbon (t/ha)')
      .toContainText('380')
      .toHaveOutline([{ title: 'Field notes' }, { title: 'Sites' }])
      .toHaveLink({ url: 'https://example.com/notes' })
      .toHaveLink({ url: 'mailto:team@example.com' })

    // Catches the Markdown image being refused.
    expect(result.diagnostics.imageWarnings).toEqual([])
    expect(Buffer.from(bytes).toString('latin1')).toContain('/Subtype /Image')
  })

  it('keeps the text of a relative link and prints a javascript: link as written', async () => {
    const content = await parseRichTextMarkdown(markdown)
    const { parsed } = await renderPdfSfc(template, { content }, { fonts })

    // Catches a relative link that loses its text or becomes an annotation.
    expectPdf(parsed).toContainText('a relative link')
    expect([...new Set(parsed.links.map(link => link.url))].sort()).toEqual(['https://example.com/notes', 'mailto:team@example.com'])
    // Catches a javascript: target becoming clickable. The docs say comark prints it as written.
    expectPdf(parsed).toContainText('javascript:alert(1)')
  })
})
