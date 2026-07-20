import { fileURLToPath } from 'node:url'
import { $fetch, fetch as nuxtFetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { parsePdf } from './utils/pdf'

describe('Nuxt PDF development workflow', async () => {
  await setup({
    dev: true,
    rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
  })

  it('renders the index page', async () => {
    // Get response to a server-rendered page with `$fetch`.
    const html = await $fetch('/')
    expect(html).toContain('<div>basic</div>')
  })

  it('renders the generated typed registry through a Nitro route', async () => {
    const response = await nuxtFetch('/api/invoice')
    const bytes = new Uint8Array(await response.arrayBuffer())
    const pdf = await parsePdf(bytes)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain(
      'filename="invoice-INV-001.pdf"',
    )
    expect(pdf.pageCount).toBe(1)
    expect(pdf.pages[0]?.text).toContain('Invoice INV-001')
    expect(pdf.pages[0]?.text).toContain('PDF framework')
  })

  it('serves development-only preview pages and raw bytes', async () => {
    const index = await nuxtFetch('/_pdf')
    const preview = await nuxtFetch('/_pdf/invoice')
    const raw = await nuxtFetch('/_pdf/invoice.pdf?scenario=long')

    expect(index.status).toBe(200)
    expect(await index.text()).toContain('href="/_pdf/invoice"')
    expect(preview.status).toBe(200)
    expect(await preview.text()).toMatch(
      /src="\/_pdf\/invoice\.pdf\?render=\d+"/,
    )
    expect(raw.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await raw.arrayBuffer()).subarray(0, 5).toString())
      .toBe('%PDF-')
  })
})
