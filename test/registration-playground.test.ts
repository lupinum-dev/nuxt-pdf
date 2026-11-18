import { resolve } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import { returningParticipant, sampleRegistration } from '../playground/shared/registration'

// The real playground form, compiled and rendered through the shipped test
// helper with the playground's Inter/Lora fonts: field sizes come from the
// `<style>` block, and pdf.js reads every field back.
const registrationSource = resolve('playground/pdfs/registration.vue')
const fonts = [
  { family: 'Inter', src: 'Inter-400.ttf', fontWeight: 400 },
  { family: 'Inter', src: 'Inter-500.ttf', fontWeight: 500 },
  { family: 'Inter', src: 'Inter-600.ttf', fontWeight: 600 },
  { family: 'Lora', src: 'Lora-700.ttf', fontWeight: 700 },
]

const fieldsOf = async (bytes: Uint8Array) => {
  const task = getDocument({ data: Uint8Array.from(bytes), verbosity: 0 })
  try {
    const page = await (await task.promise).getPage(1)
    const annotations = await page.getAnnotations()
    return Object.fromEntries(annotations.filter(item => item.subtype === 'Widget').map(item => [item.fieldName, item]))
  }
  finally {
    await task.destroy()
  }
}

describe('playground registration.vue (form fields)', () => {
  it('renders one page with the six fields of the form', async () => {
    const { bytes, parsed } = await renderPdfSfc(registrationSource, { registration: sampleRegistration }, { fonts })
    const fields = await fieldsOf(bytes)

    expect(parsed.pageCount).toBe(1)
    expect(parsed.pages[0]!.text).toContain('Field recording for beginners')
    expect(Object.keys(fields).toSorted()).toEqual(['email', 'fullName', 'interests', 'newsletter', 'ownRecorder', 'session'])
    expect(fields.fullName).toMatchObject({ fieldType: 'Tx', required: true, maxLen: 60, fieldValue: '' })
    expect(fields.interests).toMatchObject({ fieldType: 'Tx', multiLine: true })
    expect(fields.session).toMatchObject({ fieldType: 'Ch', combo: true, fieldValue: ['Morning, 9:00–12:00'] })
    expect(fields.newsletter).toMatchObject({ checkBox: true, fieldValue: 'Yes' })
    expect(fields.ownRecorder).toMatchObject({ checkBox: true, fieldValue: 'Off' })
    // The class gives the field its full content width (A5 is 419.53 pt wide, minus 2 × 44 pt).
    const [x1, , x2] = fields.email!.rect as number[]
    expect(x2! - x1!).toBeCloseTo(419.53 - 88, 2)
  })

  it('starts the name field with a known participant', async () => {
    const { bytes } = await renderPdfSfc(registrationSource, { registration: returningParticipant }, { fonts })

    expect((await fieldsOf(bytes)).fullName!.fieldValue).toBe('Ada Brightwater')
  })
})
