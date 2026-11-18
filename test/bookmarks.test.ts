import { fileURLToPath } from 'node:url'
import { defineComponent, h } from 'vue'
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
import type { DocumentNode } from '../src/runtime/server/engine/layout/index'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderDocument } from '../src/runtime/server/engine/render-document'
import { getPdfOutline, type PdfOutlineItem } from '../src/test/pdf'

const { PdfDocument, PdfImage, PdfPage, PdfText, PdfView } = PDF_COMPONENTS

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
