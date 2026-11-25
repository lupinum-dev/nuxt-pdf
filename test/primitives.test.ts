import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  PDF_ELEMENTS,
  PDF_PRIMITIVE_COMPONENT_NAMES,
  PDF_PRIMITIVE_TABLE,
} from '../src/runtime/primitives'

describe('primitive table', () => {
  // Catches a row copied with an existing tag: the derived per-tag rules would
  // silently keep only one of the two primitives.
  it('gives every primitive its own tag', () => {
    const tags = PDF_PRIMITIVE_COMPONENT_NAMES.map(name => PDF_PRIMITIVE_TABLE[name].tag)
    expect(new Set(tags).size).toBe(tags.length)
    expect(Object.keys(PDF_ELEMENTS)).toHaveLength(tags.length)
  })

  // Catches a new primitive whose props type is missing from the explicit
  // type export list in src/module.ts (API_REPORT.md mirrors the build).
  it('exports the props type of every primitive from the package root', async () => {
    const report = await readFile(new URL('../API_REPORT.md', import.meta.url), 'utf8')
    const packageRoot = report.slice(0, report.indexOf('## Nuxt module'))
    const missing = PDF_PRIMITIVE_COMPONENT_NAMES
      .filter(name => !packageRoot.includes(`type ${name}Props`))
    expect(missing).toEqual([])
  })
})
