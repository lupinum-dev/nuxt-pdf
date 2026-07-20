import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTest, fetch as nuxtFetch } from '@nuxt/test-utils/e2e'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import { parsePdf } from './utils/pdf'

const fixtureRoot = fileURLToPath(
  new URL('./fixtures/basic', import.meta.url),
)

describe('Nuxt PDF production boundary', () => {
  const nuxt = createTest({
    dev: false,
    rootDir: fixtureRoot,
  })

  beforeAll(nuxt.beforeAll, 120_000)
  beforeEach(nuxt.beforeEach)
  afterEach(nuxt.afterEach)
  afterAll(nuxt.afterAll, 30_000)

  it('renders through the built Nitro server without preview routes', async () => {
    const pdfResponse = await nuxtFetch('/api/invoice')
    const previewResponse = await nuxtFetch('/_pdf')
    const previewBody = await previewResponse.text()
    const pdf = await parsePdf(
      new Uint8Array(await pdfResponse.arrayBuffer()),
    )

    expect(pdfResponse.status).toBe(200)
    expect(pdf.pages[0]?.text).toContain('Invoice INV-001')
    expect(previewBody).toContain('<div>basic</div>')
    expect(previewBody).not.toContain('<h1>PDF templates</h1>')

    // The per-template viewer (where the diagnostics/scenario UI lives) must
    // not exist in production either — the index-page check alone would miss a
    // leaked viewer route.
    const viewerResponse = await nuxtFetch('/_pdf/invoice')
    const viewerBody = await viewerResponse.text()
    expect(viewerBody).not.toContain('class="diagnostics"')
    expect(viewerBody).not.toContain('Layout passes')
    expect(viewerBody).not.toContain('<iframe')
  })

  it('keeps React PDF engine packages out of the client bundle', async () => {
    const outputDirectory = nuxt.ctx.nuxt?.options.nitro.output?.dir
    expect(outputDirectory).toBeTruthy()
    const clientDirectory = join(outputDirectory!, 'public/_nuxt')
    const files = await readdir(clientDirectory, { recursive: true })
    const javascript = await Promise.all(
      files
        .filter(file => file.endsWith('.js'))
        .map(file => readFile(join(clientDirectory, file), 'utf8')),
    )
    const bundle = javascript.join('\n')

    expect(bundle).not.toMatch(
      /@react-pdf|fontkit|pdfkit|yoga-layout|nuxt-pdf:sfc/,
    )
  })
})
