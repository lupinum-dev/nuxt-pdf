import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { expectPdf, renderPdfSfc } from '../../src/test/index'

const template = fileURLToPath(new URL('./pdfs/accessible.vue', import.meta.url))

const fonts = [
  { family: 'Inter', src: 'Inter-400.ttf', fontWeight: 400 },
  { family: 'Inter', src: 'Inter-700.ttf', fontWeight: 700 },
]

interface StructNode {
  role?: string
  alt?: string
  children?: StructNode[]
}

const readStructure = async (bytes: Uint8Array) => {
  // pdf.js takes over the buffer it is given; hand it a copy.
  const document = await getDocument({ data: bytes.slice() }).promise
  const tree = await (await document.getPage(1)).getStructTree() as StructNode
  const metadata = await document.getMetadata()
  const blocks = tree.children?.[0]?.children ?? []
  return { blocks, info: metadata.info as Record<string, string> }
}

const roles = (node: StructNode) => (node.children ?? []).filter(child => child.role).map(child => child.role)

describe('accessible.vue', () => {
  it('claims PDF/UA-1 with a title, a language and a pinned date', async () => {
    const { bytes, parsed } = await renderPdfSfc(template, {}, { fonts })
    const { info } = await readStructure(bytes)

    expectPdf(parsed).toHavePageCount(1)
    // Catches a missing /Lang or /Title, which PDF/UA-1 requires.
    expect(info.Language).toBe('en')
    expect(info.Title).toBe('Quarterly field report')
    // Catches creationDate being ignored (the same document would change on every render).
    expect(info.CreationDate).toBe('D:20261103080000Z')
    const again = await renderPdfSfc(template, {}, { fonts })
    expect(Buffer.from(again.bytes).equals(Buffer.from(bytes))).toBe(true)
    // Catches the PDF/UA claim being left out of the XMP metadata.
    expect(Buffer.from(bytes).toString('latin1')).toMatch(/<pdfuaid:part>1<\/pdfuaid:part>/)
  })

  it('tags headings, the figure, the table and the link', async () => {
    const { bytes } = await renderPdfSfc(template, {}, { fonts })
    const { blocks } = await readStructure(bytes)

    // Catches headings or paragraphs being written as plain text, and a wrong reading order.
    expect(blocks.map(block => block.role)).toEqual(['H1', 'P', 'H2', 'Figure', 'Table', 'H2', 'P'])

    // Catches alt text lost on the chart.
    expect(blocks.find(block => block.role === 'Figure')?.alt).toContain('North 420, South 380, East 450')

    // Catches a header row that is tagged as data cells.
    const table = blocks.find(block => block.role === 'Table')!
    const rows = (table.children ?? []).filter(child => child.role === 'TR')
    expect(rows).toHaveLength(4)
    expect(roles(rows[0]!)).toEqual(['TH', 'TH', 'TH'])
    expect(rows.slice(1).every(row => roles(row).join() === 'TD,TD,TD')).toBe(true)

    // Catches the link being a bare annotation outside the structure (it must sit in a Link element of its paragraph).
    const lastParagraph = blocks.at(-1)!
    expect(roles(lastParagraph)).toEqual(['Link'])
  })

  it('keeps the link target and the text of the cells', async () => {
    const { parsed } = await renderPdfSfc(template, {}, { fonts })

    // Catches the external link being lost in a tagged document.
    expectPdf(parsed).toHaveLink({ url: 'https://example.com/field-report/method', page: 1 })
    // Catches table text missing from the page text.
    expectPdf(parsed).toContainText('Carbon (t/ha)').toContainText('450').toContainText('+7 %')
  })

  it('fails with a typed error when a heading level is skipped', async () => {
    // Catches a tagged document that silently accepts h4 after h1.
    await expect(renderPdfSfc(template, { skipLevel: true }, { fonts }))
      .rejects.toMatchObject({ code: 'PDF_TREE_INVALID', message: expect.stringContaining('skips a heading level') })
  })
})
