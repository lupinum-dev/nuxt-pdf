import { describe, expect, it } from 'vitest'
import NuxtPdf from '../src/module'

describe('Nuxt module metadata', () => {
  it('matches the Nuxt peer range published to users', async () => {
    await expect(NuxtPdf.getMeta!()).resolves.toMatchObject({
      compatibility: { nuxt: '^4.4.8' },
    })
  })
})
