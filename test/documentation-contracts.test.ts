import { compileTemplate } from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

import {
  findUnsupportedPrimitiveProps,
  loadPdfDocumentationContracts,
} from '../scripts/docs-contracts.mjs'

const contracts = await loadPdfDocumentationContracts(process.cwd())

describe('documentation contracts', () => {
  it('rejects a PdfLink example that uses src instead of href', () => {
    const result = compileTemplate({
      filename: 'invalid-link.vue',
      id: 'invalid-link',
      source: '<PdfLink :src="target">Open</PdfLink>',
    })

    expect(findUnsupportedPrimitiveProps(result.ast, contracts.primitiveProps)).toEqual([
      'Unsupported prop "src" on <PdfLink>.',
    ])
  })

  it('accepts Vue-reserved props and normalized PDF props', () => {
    const result = compileTemplate({
      filename: 'valid-link.vue',
      id: 'valid-link',
      source: '<PdfLink :key="id" href="#terms" :hit-slop="{ top: 4 }">Terms</PdfLink>',
    })

    expect(findUnsupportedPrimitiveProps(result.ast, contracts.primitiveProps)).toEqual([])
  })
})
