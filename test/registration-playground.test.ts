import { resolve } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import { returningParticipant, sampleRegistration } from '../playground/shared/registration'
import { playgroundFonts } from './fixtures/playground-fonts'

// The real playground form, compiled and rendered through the shipped test
// helper with the playground's Inter/Lora fonts: field sizes come from the
// `<style>` block, and pdf.js reads every field back.
const registrationSource = resolve('playground/pdfs/registration.vue')

const fieldsOf = async (bytes: Uint8Array) => {
  const task = getDocument({ data: Uint8Array.from(bytes), verbosity: 0 })
  try {
    const page = await (await task.promise).getPage(1)
    const annotations = await page.getAnnotations()
    const widgets = annotations.filter(item => item.subtype === 'Widget')
    // The options of a radio group share one field name; keep them as a list.
    const radios = widgets.filter(item => item.radioButton === true)
    return {
      ...Object.fromEntries(widgets.filter(item => item.radioButton !== true).map(item => [item.fieldName, item])),
      ...(radios.length > 0 && { [radios[0]!.fieldName]: radios }),
    }
  }
  finally {
    await task.destroy()
  }
}

describe('playground registration.vue (form fields)', () => {
  it('renders one page with the seven fields of the form', async () => {
    const { bytes, parsed, result } = await renderPdfSfc(registrationSource, { registration: sampleRegistration }, { fonts: playgroundFonts })
    const fields = await fieldsOf(bytes)

    // The docs gallery renders this sample and stops on any warning (scripts/docs-gallery.mjs).
    expect([...result.diagnostics.layoutWarnings, ...result.diagnostics.imageWarnings]).toEqual([])
    expect(parsed.pageCount).toBe(1)
    expect(parsed.pages[0]!.text).toContain('Field recording for beginners')
    expect(Object.keys(fields).toSorted()).toEqual(['email', 'experience', 'fullName', 'interests', 'newsletter', 'ownRecorder', 'session'])
    expect(fields.experience).toMatchObject([
      { buttonValue: 'first', alternativeText: 'First time', fieldValue: 'Off' },
      { buttonValue: 'some', alternativeText: 'Some practice', fieldValue: 'Off' },
      { buttonValue: 'regular', alternativeText: 'I record often', fieldValue: 'Off' },
    ])
    expect(fields.fullName).toMatchObject({ fieldType: 'Tx', required: true, maxLen: 60, fieldValue: '' })
    expect(fields.interests).toMatchObject({ fieldType: 'Tx', multiLine: true })
    expect(fields.session).toMatchObject({ fieldType: 'Ch', combo: true, fieldValue: ['Morning, 9:00–12:00'] })
    expect(fields.newsletter).toMatchObject({ checkBox: true, fieldValue: 'Yes' })
    expect(fields.ownRecorder).toMatchObject({ checkBox: true, fieldValue: 'Off' })
    // The class gives the field the full width of its rounded box: A5 is
    // 419.53 pt wide, minus 2 × 44 pt of margin and the box's 2 × 1 pt border.
    const [x1, , x2] = fields.email!.rect as number[]
    expect(x2! - x1!).toBeCloseTo(419.53 - 88 - 2, 2)
  })

  it('starts the name and experience fields with a known participant', async () => {
    const { bytes } = await renderPdfSfc(registrationSource, { registration: returningParticipant }, { fonts: playgroundFonts })
    const fields = await fieldsOf(bytes)

    expect(fields.fullName!.fieldValue).toBe('Ada Brightwater')
    expect(fields.experience).toMatchObject([{ fieldValue: 'some' }, { fieldValue: 'some' }, { fieldValue: 'some' }])
  })
})
