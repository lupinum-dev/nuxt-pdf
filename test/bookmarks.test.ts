import { fileURLToPath } from 'node:url'
import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import React, { type ComponentType, type ReactElement, type ReactNode } from 'react'
import {
  Document as ReactDocument,
  Image as ReactImage,
  Page as ReactPage,
  Text as ReactText,
  View as ReactView,
  renderToBuffer as renderReactDocument,
} from '@react-pdf/renderer'
import type { DocumentNode } from '@react-pdf/layout'
import {
  PdfDocument,
  PdfImage,
  PdfLink,
  PdfPage,
  PdfText,
  PdfView,
} from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import type { PdfElementNode } from '../src/runtime/renderer/types'
import { renderDocument } from '../src/runtime/server/engine/render-document'
import { renderDocumentMultiPass, type DestinationPageMap, type MultiPassSource } from '../src/runtime/server/engine/layout-passes'
import { getPdfOutline, type PdfOutlineItem } from './utils/pdf'

// One source of truth for the outline both engines must produce.
interface SectionSpec { title: string, detail: string, expanded: boolean }
interface ChapterSpec { title: string, expanded: boolean, sections: SectionSpec[] }
const CHAPTERS: ChapterSpec[] = [
  {
    title: 'Chapter 1',
    expanded: true,
    sections: [
      { title: 'Section 1.1', detail: 'Detail 1.1', expanded: true },
      { title: 'Section 1.2', detail: 'Detail 1.2', expanded: false },
    ],
  },
  {
    title: 'Chapter 2',
    expanded: false,
    sections: [{ title: 'Section 2.1', detail: 'Detail 2.1', expanded: true }],
  },
]

const expectedOutline: PdfOutlineItem[] = CHAPTERS.map(chapter => ({
  title: chapter.title,
  expanded: chapter.expanded,
  children: chapter.sections.map(section => ({
    title: section.title,
    expanded: section.expanded,
    children: [{ title: section.detail, children: [] }],
  })),
}))

// ---------------------------------------------------------------------------
// Paired React/Vue outline conformance. React PDF is a valid oracle for the
// bookmark → outline mechanics, so both engines must emit the same tree.
//
// React PDF's published types declare `bookmark` only on `Page`, but its engine
// (resolveBookmarks) honours it on every node — exactly why nuxt-pdf exposes it
// on all primitives. `bm` bridges that known type gap without `any`.
// ---------------------------------------------------------------------------
interface ReactBookmarkableProps {
  key?: string
  style?: Record<string, string | number>
  bookmark?: string | { title: string, expanded?: boolean }
  break?: boolean
  size?: string
  src?: string
}

const bm = (
  component: unknown,
  props: ReactBookmarkableProps,
  ...children: ReactNode[]
): ReactElement =>
  React.createElement(component as ComponentType<ReactBookmarkableProps>, props, ...children)

const createReactBookmarkDocument = (): ReactElement => bm(
  ReactDocument,
  {},
  ...CHAPTERS.map((chapter, chapterIndex) => bm(
    ReactPage,
    { key: chapter.title, size: 'A4', break: chapterIndex > 0, bookmark: { title: chapter.title, expanded: chapter.expanded }, style: { padding: 40 } },
    ...chapter.sections.map(section => bm(
      ReactView,
      { key: section.title, bookmark: { title: section.title, expanded: section.expanded } },
      bm(ReactText, { style: { fontSize: 16 } }, section.title),
      bm(ReactText, { bookmark: section.detail, style: { fontSize: 11 } }, section.detail),
    )),
  )),
)

const VueBookmarkDocument = defineComponent({
  name: 'VueBookmarkDocument',
  setup() {
    return () =>
      h(PdfDocument, {}, {
        default: () => CHAPTERS.map((chapter, chapterIndex) =>
          h(PdfPage, { size: 'A4', break: chapterIndex > 0, bookmark: { title: chapter.title, expanded: chapter.expanded }, style: { padding: 40 } }, {
            default: () => chapter.sections.map(section =>
              h(PdfView, { bookmark: { title: section.title, expanded: section.expanded } }, {
                default: () => [
                  h(PdfText, { style: { fontSize: 16 } }, { default: () => section.title }),
                  h(PdfText, { bookmark: section.detail, style: { fontSize: 11 } }, { default: () => section.detail }),
                ],
              }),
            ),
          }),
        ),
      })
  },
})

describe('bookmarks (outline)', () => {
  it('produces the same outline from React and Vue', async () => {
    const reactBytes = new Uint8Array(await renderReactDocument(
      createReactBookmarkDocument() as Parameters<typeof renderReactDocument>[0],
    ))
    const reactOutline = await getPdfOutline(reactBytes)

    const mounted = await mountPdfComponent(VueBookmarkDocument, {})
    let vueOutline: PdfOutlineItem[]
    try {
      const vue = await renderDocument(mounted.document as unknown as DocumentNode)
      vueOutline = await getPdfOutline(vue.bytes)
    }
    finally {
      mounted.unmount()
    }

    expect(vueOutline).toEqual(expectedOutline)
    expect(vueOutline).toEqual(reactOutline)
  }, 20_000)

  it('emits a bookmark carried by an image like React', async () => {
    const imagePath = fileURLToPath(new URL('./fixtures/assets/sample.png', import.meta.url))
    const title = 'Image appendix'
    const reactDocument = bm(
      ReactDocument,
      {},
      bm(
        ReactPage,
        { size: 'A4' },
        bm(ReactImage, {
          bookmark: title,
          src: imagePath,
          style: { width: 32, height: 32 },
        }),
      ),
    )
    const VueImageBookmarkDocument = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, { size: 'A4' }, {
          default: () => h(PdfImage, {
            bookmark: title,
            src: imagePath,
            style: { width: 32, height: 32 },
          }),
        }),
      }))

    const reactBytes = new Uint8Array(await renderReactDocument(
      reactDocument as Parameters<typeof renderReactDocument>[0],
    ))
    const mounted = await mountPdfComponent(VueImageBookmarkDocument)

    try {
      const vue = await renderDocument(mounted.document as unknown as DocumentNode)
      const expected = [{ title, children: [] }]

      expect(await getPdfOutline(vue.bytes)).toEqual(expected)
      expect(await getPdfOutline(vue.bytes)).toEqual(await getPdfOutline(reactBytes))
    }
    finally {
      mounted.unmount()
    }
  }, 20_000)
})

// ---------------------------------------------------------------------------
// Multi-pass + bookmarks. resolveBookmarks mutates props.bookmark in place
// (CONTRACTS.md layout-purity contract), so the loop must reset bookmarks
// between passes. Prove: (a) the outline is identical across two independent
// multi-pass renders and equal to the paired-oracle structure, and (b) the
// authored bookmark values are not accumulated — a fresh single render of the
// converged state yields the same outline as the multi-pass render.
// ---------------------------------------------------------------------------
// These engine-loop fixtures read the fed map from a reactive `resolved` prop,
// so the source feeds it through `update` (the composable path is covered
// end-to-end in test/toc-feature.test.ts).
const mountedSource = (
  mounted: Awaited<ReturnType<typeof mountPdfComponent>>,
): MultiPassSource => ({
  get document() {
    return mounted.document as unknown as DocumentNode
  },
  feed: async (pages: DestinationPageMap) => {
    await mounted.update({ resolved: pages })
  },
})

const footer = (): VNode =>
  h(PdfText, {
    fixed: true,
    style: { position: 'absolute', bottom: 20, left: 40, fontSize: 8 },
    render: ({ pageNumber }: { pageNumber: number }) => `p${pageNumber}`,
  })

// A document that BOTH links internally (activating multi-pass) AND carries a
// nested bookmark hierarchy, including a STRING bookmark whose stable reference
// makes Vue skip the re-patch — the exact case that would accumulate a stale
// ref/parent without the loop's reset.
const TocBookmarkDoc = defineComponent({
  props: { resolved: { type: Object, default: () => ({}) } },
  setup(props) {
    const resolved = () => props.resolved as DestinationPageMap
    return () =>
      h(PdfDocument, {}, {
        default: () => [
          h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
            default: () => [
              h(PdfText, { style: { fontSize: 20, marginBottom: 12 } }, { default: () => 'Contents' }),
              ...CHAPTERS.map(chapter =>
                h(PdfLink, { src: `#${chapter.title}`, style: { fontSize: 12, marginBottom: 6 } }, {
                  default: () => `${chapter.title} ..... ${resolved()[chapter.title] ?? ''}`,
                }),
              ),
              footer(),
            ],
          }),
          ...CHAPTERS.map(chapter =>
            h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
              default: () => [
                h(PdfView, { id: chapter.title, bookmark: { title: chapter.title, expanded: chapter.expanded }, break: true }, {
                  default: () => chapter.sections.map(section =>
                    h(PdfView, { bookmark: { title: section.title, expanded: section.expanded } }, {
                      default: () => [
                        h(PdfText, { style: { fontSize: 16 } }, { default: () => section.title }),
                        h(PdfText, { bookmark: section.detail, style: { fontSize: 11 } }, { default: () => section.detail }),
                        ...Array.from({ length: 30 }, (_, i) =>
                          h(PdfText, { style: { fontSize: 10 } }, { default: () => `${section.title} line ${i + 1}` }),
                        ),
                      ],
                    }),
                  ),
                }),
                footer(),
              ],
            }),
          ),
        ],
      })
  },
})

const collectBookmarks = (root: PdfElementNode): unknown[] => {
  const found: unknown[] = []
  const visit = (node: PdfElementNode): void => {
    if ('bookmark' in node.props) found.push(node.props.bookmark)
    for (const child of node.children) {
      if ('props' in child) visit(child as PdfElementNode)
    }
  }
  visit(root)
  return found
}

// A fixture where a bookmark's ANCESTRY changes across passes: the parent
// bookmark only appears once the page number is resolved, while the child keeps
// a module-constant (stable-reference) string bookmark that Vue never re-patches.
// Without the loop's reset, the child's props.bookmark accumulates pass-1's
// resolved `{ ref: 0, … }`; on pass 2 the `{ …bookmark }` spread restores that
// stale ref, colliding with the parent's ref and corrupting the outline. The
// reset makes this a correct Parent → Child hierarchy.
const STABLE_CHILD_BOOKMARK = 'Child detail'

const AncestryShiftDoc = defineComponent({
  props: { resolved: { type: Object, default: () => ({}) } },
  setup(props) {
    const resolved = () => props.resolved as DestinationPageMap
    return () =>
      h(PdfDocument, {}, {
        default: () => [
          h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
            default: () => [
              h(PdfLink, { src: '#t', style: { fontSize: 12 } }, { default: () => `Go ..... ${resolved().t ?? ''}` }),
              h(PdfView, { bookmark: resolved().t ? 'Parent' : undefined }, {
                default: () => h(PdfText, { bookmark: STABLE_CHILD_BOOKMARK, style: { fontSize: 12 } }, { default: () => STABLE_CHILD_BOOKMARK }),
              }),
            ],
          }),
          h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
            default: () => h(PdfText, { id: 't', break: true }, { default: () => 'HEADING t' }),
          }),
        ],
      })
  },
})

describe('multi-pass + bookmarks', () => {
  it('resets bookmarks between passes so a shifting ancestry stays correct', async () => {
    const mounted = await mountPdfComponent(AncestryShiftDoc, { resolved: {} })
    try {
      const result = await renderDocumentMultiPass(mountedSource(mounted))
      expect(result.passes).toBeGreaterThanOrEqual(2)
      // The parent bookmark (added only on pass ≥ 2) correctly owns the child.
      expect(await getPdfOutline(result.bytes)).toEqual([
        { title: 'Parent', expanded: false, children: [{ title: STABLE_CHILD_BOOKMARK, children: [] }] },
      ])
    }
    finally {
      mounted.unmount()
    }
  }, 20_000)

  it('keeps the outline identical across renders and does not accumulate bookmarks', async () => {
    const a = await mountPdfComponent(TocBookmarkDoc, { resolved: {} })
    const b = await mountPdfComponent(TocBookmarkDoc, { resolved: {} })
    try {
      const first = await renderDocumentMultiPass(mountedSource(a))
      const second = await renderDocumentMultiPass(mountedSource(b))

      const outlineFirst = await getPdfOutline(first.bytes)
      const outlineSecond = await getPdfOutline(second.bytes)

      // Two independent multi-pass renders agree, and match the paired oracle
      // structure (chapters carry the bookmark; sections and details nest under).
      expect(outlineFirst).toEqual(outlineSecond)
      expect(outlineFirst).toEqual(expectedOutline)

      // A fresh single render of the converged state produces the same outline —
      // proving the loop's re-layout left no corrupted bookmark hierarchy behind.
      const c = await mountPdfComponent(TocBookmarkDoc, { resolved: {} })
      try {
        await c.feedPageNumbers(first.pages)
        const single = await renderDocument(c.document as unknown as DocumentNode)
        expect(await getPdfOutline(single.bytes)).toEqual(expectedOutline)
      }
      finally {
        c.unmount()
      }

      // Every resolved bookmark carries exactly one `ref` and its refs are a
      // contiguous 0..n-1 range — a stale, accumulated hierarchy would duplicate
      // or gap the ref sequence.
      const refs = collectBookmarks(a.document as unknown as PdfElementNode)
        .map(bookmark => (bookmark as { ref?: number }).ref)
        .sort((x, y) => (x ?? 0) - (y ?? 0))
      expect(refs).toEqual(refs.map((_, index) => index))
    }
    finally {
      a.unmount()
      b.unmount()
    }
  }, 30_000)

  it('handles a bookmark that first appears mid-loop behind a resolved page number', async () => {
    // Pass 1 feeds an empty map, so the bookmark (and a spacer that changes the
    // target's page) do not exist yet. Pass 2 mounts them, its layout resolves
    // the bookmark, AND the spacer moves the target — forcing a pass 3 that
    // re-lays-out the already-resolved bookmark. The per-pass snapshot must
    // have recorded the bookmark's AUTHORED value when it first appeared (not
    // only at loop start), or pass 3 would spread the stale resolved
    // {ref, parent} object into the outline.
    const LateBookmarkDoc = defineComponent({
      props: { resolved: { type: Object, default: () => ({}) } },
      setup(props: { resolved: Record<string, number | undefined> }) {
        return () =>
          h(PdfDocument, {}, {
            default: () => [
              h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
                default: () => h(PdfLink, { src: '#late', style: { fontSize: 13 } }, {
                  default: () => `Late section ..... ${props.resolved.late ?? ''}`,
                }),
              }),
              h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
                default: () => [
                  ...(props.resolved.late === undefined
                    ? []
                    : [h(PdfView, { style: { height: 780 } }, {
                        default: () => h(PdfText, {}, { default: () => 'spacer' }),
                      })]),
                  h(
                    PdfView,
                    props.resolved.late === undefined
                      ? {}
                      : { bookmark: { title: 'Late chapter' } },
                    { default: () => h(PdfText, { id: 'late' }, { default: () => 'HEADING late' }) },
                  ),
                ],
              }),
            ],
          })
      },
    })

    const mounted = await mountPdfComponent(LateBookmarkDoc, { resolved: {} })
    try {
      const result = await renderDocumentMultiPass(mountedSource(mounted))

      // Pass 1: {} → late=2. Pass 2: spacer+bookmark appear, late moves → 3.
      // Pass 3: stable. The bookmark was laid out twice (passes 2 and 3).
      expect(result.passes).toBe(3)
      expect(result.pages.late).toBe(3)
      const outline = await getPdfOutline(result.bytes)
      expect(outline.map(item => item.title)).toEqual(['Late chapter'])
    }
    finally {
      mounted.unmount()
    }
  }, 30_000)
})
