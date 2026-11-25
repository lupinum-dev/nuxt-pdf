import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { expectPdf, renderPdfSfc } from '../../src/test/index'

const template = fileURLToPath(new URL('./pdfs/registration.vue', import.meta.url))

const fonts = [
  { family: 'Inter', src: 'Inter-400.ttf', fontWeight: 400 },
  { family: 'Inter', src: 'Inter-700.ttf', fontWeight: 700 },
]

const renderForm = async (archival: boolean) => {
  const { bytes, parsed } = await renderPdfSfc(template, { archival }, { fonts })
  // pdf.js takes over the buffer it is given; hand it a copy so the bytes stay readable.
  const document = await getDocument({ data: bytes.slice() }).promise
  const annotations = await (await document.getPage(1)).getAnnotations()
  const fields = annotations.filter(annotation => annotation.subtype === 'Widget')
  return { bytes, parsed, fields, raw: Buffer.from(bytes).toString('latin1') }
}

describe('registration.vue', () => {
  it('writes one field of each kind with the starting values', async () => {
    const { parsed, fields } = await renderForm(false)
    const byName = (name: string) => fields.filter(field => field.fieldName === name)

    expectPdf(parsed).toHavePageCount(1)
    // Catches a visible label that is lost when a field is next to it.
    expectPdf(parsed).toContainText('Full name').toContainText('Send me the newsletter')

    // Catches a field that is missing or out of template order; a radio group is three widgets, one name.
    expect(fields.map(field => field.fieldName)).toEqual(['fullName', 'notes', 'session', 'shirt', 'shirt', 'shirt', 'newsletter'])

    // Catches the text value, the required flag or maxLength not reaching the PDF.
    expect(byName('fullName')[0]).toMatchObject({ fieldType: 'Tx', fieldValue: 'Ada Lovelace', required: true, maxLen: 60, multiLine: false })

    // Catches `multiline` being ignored, and a line break in the value being lost.
    expect(byName('notes')[0]).toMatchObject({ multiLine: true, fieldValue: 'Vegetarian lunch, please.\nArriving by train.' })

    // Catches a drop-down that loses its choices or its selected value.
    expect(byName('session')[0]).toMatchObject({ fieldType: 'Ch', fieldValue: ['Afternoon'] })
    expect(byName('session')[0]!.options.map((option: { exportValue: string }) => option.exportValue)).toEqual(['Morning', 'Afternoon', 'Full day'])

    // Catches a radio group that is split into separate fields, or the wrong option being on.
    expect(byName('shirt').map(field => field.buttonValue)).toEqual(['S', 'M', 'L'])
    expect(byName('shirt').every(field => field.radioButton && field.fieldValue === 'M')).toBe(true)

    // Catches a checkbox that starts unchecked or exports another value than the default 'Yes'.
    expect(byName('newsletter')[0]).toMatchObject({ checkBox: true, fieldValue: 'Yes' })
  })

  it('claims PDF/A-3b and embeds the whole field font in the second render', async () => {
    const plain = await renderForm(false)
    const archival = await renderForm(true)

    // Catches the PDF/A claim not being written (XMP identification part 3, conformance B).
    expect(archival.raw).toMatch(/<pdfaid:part>3<\/pdfaid:part>/)
    expect(archival.raw).toMatch(/<pdfaid:conformance>B<\/pdfaid:conformance>/)
    expect(plain.raw).not.toContain('pdfaid:')

    // Catches the fields still drawing in Helvetica, which PDF/A forbids unembedded.
    // The page text is subset (prefix "ABCDEF+"); the whole font for the fields has no prefix.
    expect(plain.raw).toContain('/BaseFont /Helvetica')
    expect(archival.raw).not.toContain('/BaseFont /Helvetica')
    expect(archival.raw).toContain('/BaseFont /Inter-Regular')

    // Catches the whole font file missing: the docs say it adds roughly the compressed font size.
    expect(archival.bytes.length - plain.bytes.length).toBeGreaterThan(50_000)

    // Catches the claim changing the form itself.
    expect(archival.fields.map(field => [field.fieldName, field.fieldValue]))
      .toEqual(plain.fields.map(field => [field.fieldName, field.fieldValue]))
    expectPdf(archival.parsed).toHavePageCount(1)

    // Catches a creationDate that is ignored: the same document and date must give the same bytes.
    const again = await renderForm(true)
    expect(Buffer.from(again.bytes).equals(Buffer.from(archival.bytes))).toBe(true)
  })
})
