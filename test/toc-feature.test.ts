import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PdfDocument,
  PdfLink,
  PdfPage,
  PdfText,
  PdfView,
} from '../src/runtime/components'
import { usePdfPageNumbers } from '../src/runtime/composables'
import { createPdfTemplate } from '../src/runtime/server/registry'
import * as layoutPasses from '../src/runtime/server/engine/layout-passes'
import { PDF_DEFINITION_PROPERTY, type PdfDefinition } from '../src/runtime/shared/template'
import { NuxtPdfError } from '../src/runtime/shared/errors'
import { installPdfCanvasGlobals, parsePdf } from './utils/pdf'

interface Section { id: string, title: string, lines: number }
const SECTIONS: Section[] = [
  { id: 'intro', title: 'Introduction', lines: 3 },
  { id: 'method', title: 'Method', lines: 60 }, // spans two pages
  { id: 'results', title: 'Results', lines: 3 },
]

const withDefinition = (
  component: ReturnType<typeof defineComponent>,
  definition: PdfDefinition,
): ReturnType<typeof defineComponent> => {
  Object.defineProperty(component, PDF_DEFINITION_PROPERTY, { value: definition })
  return component
}

// A realistic TOC template that reads resolved page numbers through the
// PUBLIC composable — the productized activation path (no fixture prop).
const TocTemplate = withDefinition(
  defineComponent({
    name: 'TocTemplate',
    setup() {
      const pageNumbers = usePdfPageNumbers()
      return () =>
        h(PdfDocument, { title: 'Report' }, {
          default: () => [
            h(PdfPage, { size: 'A4', style: { padding: 48 } }, {
              default: () => [
                h(PdfText, { style: { fontSize: 22, marginBottom: 16 } }, { default: () => 'Contents' }),
                ...SECTIONS.map(s =>
                  h(PdfLink, { src: `#${s.id}`, style: { fontSize: 13, marginBottom: 8, color: 'black' } }, {
                    default: () => `${s.title} ..... ${pageNumbers[s.id] ?? ''}`,
                  }),
                ),
              ],
            }),
            ...SECTIONS.map(s =>
              h(PdfPage, { size: 'A4', style: { padding: 48 } }, {
                default: () => [
                  h(PdfText, { id: s.id, break: true, style: { fontSize: 20, marginBottom: 12 } }, {
                    default: () => `HEADING ${s.id}`,
                  }),
                  ...Array.from({ length: s.lines }, (_, i) =>
                    h(PdfText, { style: { fontSize: 11, marginBottom: 4 } }, { default: () => `${s.title} line ${i + 1}` }),
                  ),
                ],
              }),
            ),
          ],
        })
    },
  }),
  { title: 'Report' },
)

// No composable, no internal link: must stay single-pass.
const PlainTemplate = withDefinition(
  defineComponent({
    name: 'PlainTemplate',
    setup() {
      return () =>
        h(PdfDocument, { title: 'Plain' }, {
          default: () => h(PdfPage, { size: 'A4', style: { padding: 48 } }, {
            default: () => [
              h(PdfText, {}, { default: () => 'Just a page.' }),
              h(PdfLink, { href: 'https://nuxt.com' }, { default: () => 'external' }),
            ],
          }),
        })
    },
  }),
  { title: 'Plain' },
)

// No composable, but an internal #id link: activates multi-pass on its own.
const LinkOnlyTemplate = withDefinition(
  defineComponent({
    name: 'LinkOnlyTemplate',
    setup() {
      return () =>
        h(PdfDocument, {}, {
          default: () => [
            h(PdfPage, { size: 'A4', style: { padding: 48 } }, {
              default: () => h(PdfLink, { src: '#target', style: { fontSize: 13 } }, { default: () => 'Jump to target' }),
            }),
            h(PdfPage, { size: 'A4', style: { padding: 48 } }, {
              default: () => h(PdfText, { id: 'target', break: true }, { default: () => 'HEADING target' }),
            }),
          ],
        })
    },
  }),
  {},
)

const locateHeadingPages = (pages: { number: number, text: string }[]): Record<string, number> => {
  const located: Record<string, number> = {}
  for (const s of SECTIONS) {
    const page = pages.find(p => p.text.includes(`HEADING ${s.id}`))
    if (page) located[s.id] = page.number
  }
  return located
}

describe('table-of-contents feature (productized)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('resolves correct page numbers through usePdfPageNumbers via the registry', async () => {
    const template = createPdfTemplate('report', TocTemplate)
    const bytes = await (await template.render({})).toUint8Array()
    const parsed = await parsePdf(bytes)

    const located = locateHeadingPages(parsed.pages)
    expect(Object.keys(located)).toHaveLength(SECTIONS.length)

    // Every TOC entry prints the page its heading actually landed on.
    const tocText = parsed.pages[0]!.text
    for (const s of SECTIONS) {
      expect(tocText).toContain(`${s.title} ..... ${located[s.id]}`)
    }

    // Internal link annotations on the TOC page target the section starts.
    const tocLinks = parsed.pages[0]!.annotations.filter(a => a.subtype === 'Link')
    expect(tocLinks.length).toBeGreaterThanOrEqual(SECTIONS.length)
    for (const s of SECTIONS) {
      expect(tocLinks.some(a => a.destination === s.id)).toBe(true)
    }
  }, 20_000)

  it('runs exactly one layout pass for a plain document (multi-pass gate stays off)', async () => {
    const spy = vi.spyOn(layoutPasses, 'renderDocumentMultiPass')
    const template = createPdfTemplate('plain', PlainTemplate)
    const bytes = await (await template.render({})).toUint8Array()

    expect(spy).not.toHaveBeenCalled()
    expect(new Uint8Array(bytes).slice(0, 5)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]))
  })

  it('keeps an internal-#id-link document on the single-pass path', async () => {
    // A named destination resolves by NAME in one pass (anchored at the
    // section's first page during serialization), so a link alone must not pay
    // for the multi-pass loop. Only usePdfPageNumbers() activates it.
    const spy = vi.spyOn(layoutPasses, 'renderDocumentMultiPass')
    const template = createPdfTemplate('link-only', LinkOnlyTemplate)
    const pdf = await parsePdf(await (await template.render({})).toUint8Array())

    expect(spy).not.toHaveBeenCalled()

    const links = pdf.pages.flatMap(page => page.annotations)
    expect(links.some(link => link.destination === 'target')).toBe(true)
  })

  it('fails fast when usePdfPageNumbers is called outside a PDF render', () => {
    expect(() => usePdfPageNumbers()).toThrow(
      /only available inside a PDF template/,
    )
  })

  it('rejects a non-positive maxPasses at definePdf validation', () => {
    const bad = withDefinition(
      defineComponent({ name: 'Bad', setup: () => () => h(PdfDocument, {}, { default: () => h(PdfPage, {}) }) }),
      { maxPasses: 0 },
    )
    expect(() => createPdfTemplate('bad', bad, { file: 'pdfs/bad.vue' }))
      .toThrow(/maxPasses must be a positive integer/)
  })

  it('names the template when page numbers do not converge', async () => {
    // A TOC entry whose height depends on the number it prints never stabilizes.
    const Oscillator = withDefinition(
      defineComponent({
        name: 'Oscillator',
        setup() {
          const pageNumbers = usePdfPageNumbers()
          return () =>
            h(PdfDocument, {}, {
              default: () => [
                h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
                  default: () => [
                    h(PdfLink, { src: '#only', style: { fontSize: 14 } }, { default: () => `Ch ..... ${pageNumbers.only ?? ''}` }),
                    h(PdfView, { style: { height: pageNumbers.only === 2 ? 790 : 0 } }),
                  ],
                }),
                h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
                  default: () => h(PdfText, { id: 'only' }, { default: () => 'HEADING only' }),
                }),
              ],
            })
        },
      }),
      { title: 'Osc', maxPasses: 4 },
    )

    installPdfCanvasGlobals()
    const template = createPdfTemplate('oscillator', Oscillator, { file: 'pdfs/oscillator.vue' })
    const error = await template.render({}).then(() => null).catch(e => e as unknown)

    expect(error).toBeInstanceOf(NuxtPdfError)
    const nuxtError = error as NuxtPdfError
    expect(nuxtError.code).toBe('PDF_LIMIT_EXCEEDED')
    expect(nuxtError.templateKey).toBe('oscillator')
    expect(nuxtError.message).toContain('pdfs/oscillator.vue')
    expect(nuxtError.message).toContain('did not stabilize')
  }, 20_000)
})
