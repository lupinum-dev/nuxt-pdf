import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENT_NAMES } from '../src/runtime/component-names'
import { createPdfStub } from '../src/runtime/plugins/pdf-stub'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'

describe('development-only Pdf* stubs', () => {
  // Catches a stub that renders nothing (the silent failure it exists to stop)
  // or names the wrong component.
  it('fails with an actionable error for every authoring component', async () => {
    for (const name of PDF_COMPONENT_NAMES) {
      await expect(renderToString(createSSRApp(createPdfStub(name)))).rejects.toMatchObject({
        name: NuxtPdfError.name,
        code: PDF_ERROR_CODES.TemplateInvalid,
        message: expect.stringContaining(`<${name}> only works inside a discovered pdfs/`),
      })
    }
  })
})
