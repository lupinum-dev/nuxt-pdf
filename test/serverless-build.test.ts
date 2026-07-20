import { execFile } from 'node:child_process'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'

// Proves the module builds under a serverless Nitro preset. We build the basic
// fixture with the Vercel preset and inspect the emitted bundle; we do NOT
// execute the Vercel runtime locally. Execution is verified on node-server by
// test/production.test.ts. The claim here is exactly: it builds under the vercel
// preset, the engine lands in the server bundle, the .vercel/output structure is
// emitted, and no React renderer runtime leaked into it.

const run = promisify(execFile)

const fixtureRoot = fileURLToPath(new URL('./fixtures/basic', import.meta.url))
const outputRoot = join(fixtureRoot, '.vercel', 'output')

// Engine packages that MUST be present in the server bundle (the module renders
// PDFs through React PDF's exact-pinned layout/render engine, server-side only).
const ENGINE_MARKERS = ['@react-pdf/pdfkit', '@react-pdf/layout', '@react-pdf/render']

// React renderer runtime that MUST NOT leak: the module drives a Vue custom
// renderer, never React's reconciler or the full react-based @react-pdf/renderer.
const REACT_RUNTIME_MARKERS = [
  '@react-pdf/renderer',
  'react-reconciler',
  'react-dom',
  'react/jsx-runtime',
]

const readServerBundle = async (): Promise<string> => {
  const functionsDir = join(outputRoot, 'functions')
  const files = await readdir(functionsDir, { recursive: true })
  const sources = await Promise.all(
    files
      .filter(file => file.endsWith('.mjs'))
      .map(file => readFile(join(functionsDir, file), 'utf8').catch(() => '')),
  )
  return sources.join('\n')
}

describe('Nuxt PDF serverless build boundary', () => {
  let bundle = ''

  beforeAll(async () => {
    await rm(join(fixtureRoot, '.vercel'), { recursive: true, force: true })
    await run('npx', ['nuxt', 'build'], {
      cwd: fixtureRoot,
      env: { ...process.env, NITRO_PRESET: 'vercel' },
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    bundle = await readServerBundle()
  }, 180_000)

  it('emits the .vercel/output serverless structure', async () => {
    expect((await stat(join(outputRoot, 'config.json'))).isFile()).toBe(true)
    expect((await stat(join(outputRoot, 'functions'))).isDirectory()).toBe(true)
  })

  it('bundles the React PDF engine into the server functions', () => {
    for (const marker of ENGINE_MARKERS) {
      expect(bundle, `expected engine marker "${marker}" in server bundle`)
        .toContain(marker)
    }
  })

  it('does not leak a React renderer runtime into the server bundle', () => {
    for (const marker of REACT_RUNTIME_MARKERS) {
      expect(bundle, `React runtime marker "${marker}" leaked into server bundle`)
        .not.toContain(marker)
    }
  })
})
