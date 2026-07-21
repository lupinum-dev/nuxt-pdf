import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { fetch as nuxtFetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { parsePdf } from './utils/pdf'

const fixtureRoot = fileURLToPath(
  new URL('./fixtures/layers', import.meta.url),
)
const execFileAsync = promisify(execFile)
const vueTsc = fileURLToPath(import.meta.resolve('vue-tsc/bin/vue-tsc.js'))
const projectInvoice = join(fixtureRoot, 'pdfs/invoice.vue')
const baseInvoice = join(fixtureRoot, 'layers/base/pdfs/invoice.vue')
const baseCertificate = join(
  fixtureRoot,
  'layers/base/pdfs/certificate.vue',
)

describe('Nuxt PDF layer precedence', async () => {
  await setup({
    dev: false,
    rootDir: fixtureRoot,
  })

  it('uses the project template for a matching key', async () => {
    const response = await nuxtFetch('/api/document?name=invoice')
    const pdf = await parsePdf(
      new Uint8Array(await response.arrayBuffer()),
    )

    expect(response.status).toBe(200)
    expect(pdf.pages[0]?.text).toContain('PROJECT OVERRIDE: Project route')
    expect(pdf.pages[0]?.text).not.toContain('BASE INVOICE')
  })

  it('keeps a base-only template renderable', async () => {
    const response = await nuxtFetch('/api/document?name=certificate')
    const pdf = await parsePdf(
      new Uint8Array(await response.arrayBuffer()),
    )

    expect(response.status).toBe(200)
    expect(pdf.pages[0]?.text).toContain(
      'BASE CERTIFICATE: Grace Hopper',
    )
  })

  it('generates and enforces #pdf types from the winning sources', async () => {
    const generatedTypes = await readFile(
      join(fixtureRoot, '.nuxt/types/nuxt-pdf-registry.ts'),
      'utf8',
    )

    expect(generatedTypes).toContain(projectInvoice)
    expect(generatedTypes).toContain(baseCertificate)
    expect(generatedTypes).not.toContain(baseInvoice)
    expect(generatedTypes).toContain('readonly "invoice"')
    expect(generatedTypes).toContain('readonly "certificate"')

    await expect(execFileAsync(process.execPath, [
      vueTsc,
      '--noEmit',
      '-p',
      join(fixtureRoot, 'tsconfig.json'),
    ])).resolves.toMatchObject({ stderr: '' })
  }, 30_000)
})
