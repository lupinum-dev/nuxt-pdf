import type { DocumentNode } from '@react-pdf/layout'
import * as P from '@react-pdf/primitives'
import { describe, expect, it } from 'vitest'
import { renderDocument } from '../src/runtime/server/engine/render-document'

const createDocument = (): DocumentNode => ({
  type: P.Document,
  props: {
    title: 'Engine proof',
    creationDate: new Date('2026-07-20T00:00:00.000Z'),
  },
  children: [
    {
      type: P.Page,
      box: {},
      style: { padding: 32 },
      props: { size: 'A4' },
      children: [
        {
          type: P.Text,
          box: {},
          style: { fontFamily: 'Helvetica', fontSize: 18 },
          props: {},
          children: [
            { type: P.TextInstance, value: 'Nuxt PDF engine proof' },
          ],
        },
      ],
    },
  ],
} as DocumentNode)

describe('React PDF engine pipeline', () => {
  it('lays out and serializes a compatible document tree', async () => {
    const result = await renderDocument(createDocument())
    const header = Buffer.from(result.bytes.subarray(0, 5)).toString('ascii')

    expect(header).toBe('%PDF-')
    expect(result.bytes.byteLength).toBeGreaterThan(500)
    expect(result.layout.children).toHaveLength(1)
    expect(result.layout.children[0]?.box?.width).toBeGreaterThan(0)
  })

  it('rejects a non-document root before layout', async () => {
    const invalid = { ...createDocument(), type: P.Page } as unknown as DocumentNode

    await expect(renderDocument(invalid)).rejects.toThrow(
      'Expected a DOCUMENT root, received PAGE',
    )
  })
})
