import { describe, expect, it } from 'vitest'
import { definePdf } from '../src/runtime/define-pdf'

describe('definePdf runtime fallback', () => {
  it('fails clearly when the compiler macro is used outside a PDF template', () => {
    expect(() => definePdf({ title: 'Misplaced' })).toThrow(
      'definePdf() is a compiler macro that only works as a top-level call in a discovered pdfs/*.vue template.',
    )
  })
})
