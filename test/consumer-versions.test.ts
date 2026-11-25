import { describe, expect, it } from 'vitest'
import { consumerVersions } from '../scripts/consumer-versions.mjs'

const peers = {
  'nuxt': '^4.2.0',
  'vue': '^3.4.0',
  'pdfjs-dist': '^5.1.0 || ^6.1.0',
  '@napi-rs/canvas': '^0.1.2',
  'comark': '^0.8.1 || ^0.9.2',
}
const current = {
  'nuxt': '4.3.0',
  'vue': '3.5.0',
  'pdfjs-dist': '6.2.0',
  '@napi-rs/canvas': '0.1.3',
  'comark': '0.9.4',
  'typescript': '5.9.3',
}
const { comark: _comark, ...withoutComark } = current

describe('packed consumer version profiles', () => {
  // Catches a matrix that never tests the lowest comark, or never an app
  // without the optional peer (its build and its typed error).
  it('derives minima from peers, keeps the actual current toolchain and adds a profile without comark', () => {
    expect(consumerVersions(peers, current)).toEqual([
      { name: 'minimum', versions: { ...current, 'nuxt': '4.2.0', 'vue': '3.4.0', 'pdfjs-dist': '5.1.0', '@napi-rs/canvas': '0.1.2', 'comark': '0.8.1' } },
      { name: 'current', versions: current },
      { name: 'without-comark', versions: withoutComark },
    ])
  })

  it('does not repeat identical profiles', () => {
    const versions = { ...current, 'nuxt': '4.2.0', 'vue': '3.4.0', 'pdfjs-dist': '5.1.0', '@napi-rs/canvas': '0.1.2', 'comark': '0.8.1' }
    const { comark: _minimumComark, ...without } = versions
    expect(consumerVersions(peers, versions)).toEqual([{ name: 'current', versions }, { name: 'without-comark', versions: without }])
  })

  it('rejects unsupported ranges and current versions outside the public contract', () => {
    expect(() => consumerVersions({ ...peers, nuxt: '>=4' }, current)).toThrow('unsupported nuxt peer range')
    expect(() => consumerVersions(peers, { ...current, nuxt: '5.0.0' })).toThrow('outside the declared peer range')
    expect(() => consumerVersions(peers, { ...current, 'pdfjs-dist': '6.0.0' })).toThrow('outside the declared peer range')
    expect(() => consumerVersions(peers, { ...current, '@napi-rs/canvas': '0.2.0' })).toThrow('outside the declared peer range')
    expect(() => consumerVersions(peers, { ...current, comark: '0.10.0' })).toThrow('outside the declared peer range')
  })
})
