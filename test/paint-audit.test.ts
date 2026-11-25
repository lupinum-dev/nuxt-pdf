import { describe, expect, it } from 'vitest'
import { parsePdf } from '../src/test/pdf'
import { renderPreparedPdfTemplate } from '../src/test/render-template'
import { PAINT_AUDIT_DOCUMENTS } from './fixtures/paint-audit'

// The paint audit documents are the input of step 2's pixel comparison; this keeps them
// rendering when validation changes, so no form silently drops out of it.

describe('paint audit documents', () => {
  it('render every audit document', async () => {
    const pages: Record<string, number> = {}
    for (const [name, component] of Object.entries(PAINT_AUDIT_DOCUMENTS)) {
      const { bytes } = await renderPreparedPdfTemplate(component, {})
      pages[name] = (await parsePdf(bytes)).pageCount
    }
    expect(pages).toEqual({ colors: 1, boxes: 1, text: 1, images: 1, svg: 1, navigation: 2 })
  })
})
