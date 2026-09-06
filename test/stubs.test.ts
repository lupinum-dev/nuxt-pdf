import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import * as components from '../src/runtime/components'
import * as stubs from '../src/runtime/components/stubs'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'

describe('development-only Pdf* stubs', () => {
  it('exports a runtime guard for every authoring component', async () => {
    const names = Object.keys(components).filter(name => name.startsWith('Pdf')).sort()
    const guards = Object.entries(stubs).filter(([name]) => name.startsWith('Pdf'))
    expect(guards.map(([name]) => name).sort()).toEqual(names)
    for (const [name, guard] of guards) {
      await expect(renderToString(createSSRApp(guard))).rejects.toMatchObject({
        name: NuxtPdfError.name,
        code: PDF_ERROR_CODES.TemplateInvalid,
        message: expect.stringContaining(`<${name}> only works inside a discovered pdfs/`),
      })
    }
  })
})
