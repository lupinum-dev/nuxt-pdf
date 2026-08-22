import { describe, expect, it } from 'vitest'
import { version } from '../package.json'
import NuxtPdf from '../src/module'

describe('Nuxt module metadata', () => {
  it('matches the Nuxt peer range published to users', async () => {
    await expect(NuxtPdf.getMeta!()).resolves.toMatchObject({
      compatibility: { nuxt: '>=4.4.8' },
    })
  })

  it('carries the published package identity', async () => {
    await expect(NuxtPdf.getMeta!()).resolves.toMatchObject({
      name: '@lupinum/nuxt-pdf',
      version,
      configKey: 'pdf',
      docs: 'https://nuxt-pdf.lupinum.com',
    })
  })
})
