import {
  Fragment,
  defineComponent,
  h,
  resolveComponent,
  type PropType,
} from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FontStore from '@react-pdf/font'
import layoutDocument, {
  type DocumentNode,
  type SafeDocumentNode,
} from '@react-pdf/layout'
import * as UpstreamPrimitives from '@react-pdf/primitives'
import {
  PdfDocument,
  PdfPage,
  PdfText,
  PdfView,
} from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import {
  PDF_PRIMITIVES,
  type PdfElementNode,
  type PdfStyle,
  type PdfTextInstance,
} from '../src/runtime/renderer/types'

type Item = {
  id: string
  label: string
}

const elementChild = (
  parent: PdfElementNode,
  index: number,
): PdfElementNode => parent.children[index] as PdfElementNode

const textChild = (
  parent: PdfElementNode,
  index = 0,
): PdfTextInstance => parent.children[index] as PdfTextInstance

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Vue PDF host renderer', () => {
  it('resolves PDF primitives in the custom renderer app context', async () => {
    const Fixture = defineComponent({
      setup() {
        const Document = resolveComponent('PdfDocument')
        const Page = resolveComponent('PdfPage')
        const Text = resolveComponent('PdfText')

        return () => h(Document, null, {
          default: () => h(Page, { size: 'A4' }, {
            default: () => h(Text, null, () => 'Globally resolved primitives'),
          }),
        })
      },
    })
    const mounted = await mountPdfComponent(Fixture)

    expect(textChild(elementChild(elementChild(mounted.document, 0), 0)).value)
      .toBe('Globally resolved primitives')

    mounted.unmount()
  })

  it('uses the upstream primitive contract and feeds layout directly', async () => {
    expect(PDF_PRIMITIVES).toMatchObject({
      Document: UpstreamPrimitives.Document,
      Page: UpstreamPrimitives.Page,
      View: UpstreamPrimitives.View,
      Text: UpstreamPrimitives.Text,
      Image: UpstreamPrimitives.Image,
      Link: UpstreamPrimitives.Link,
      Note: UpstreamPrimitives.Note,
      TextInstance: UpstreamPrimitives.TextInstance,
    })

    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, { size: 'A4' }, {
          default: () => h(PdfText, null, () => 'Layout input'),
        }),
      }),
    )
    const mounted = await mountPdfComponent(Fixture)
    const layoutWithFontStore = layoutDocument as unknown as (
      document: DocumentNode,
      fontStore: FontStore,
    ) => Promise<SafeDocumentNode>
    const layout = await layoutWithFontStore(
      mounted.document as unknown as DocumentNode,
      new FontStore(),
    )

    expect(layout.children).toHaveLength(1)
    expect(layout.children[0]?.box).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
    })

    mounted.unmount()
  })

  it('mounts and patches one layout-compatible document tree', async () => {
    const renderPageNumber = vi.fn(() => 0)
    const Fixture = defineComponent({
      props: {
        title: { type: String, required: true },
        showConditional: { type: Boolean, required: true },
        showDynamic: { type: Boolean, required: true },
        items: {
          type: Array as PropType<Item[]>,
          required: true,
        },
        titleStyle: {
          type: Object as PropType<PdfStyle | undefined>,
          default: undefined,
        },
      },
      setup(props) {
        return () => h(PdfDocument, { title: 'Renderer fixture' }, {
          default: () => h(PdfPage, { size: 'A4' }, {
            default: () => [
              h(PdfText, {
                id: 'title',
                style: props.titleStyle,
              }, () => props.title),
              props.showConditional
                ? h(PdfView, { id: 'conditional' }, {
                    default: () => h(PdfText, null, () => 'Visible'),
                  })
                : null,
              h(Fragment, null, props.items.map(item =>
                h(PdfText, { id: item.id, key: item.id }, () => item.label),
              )),
              h(PdfText, {
                id: 'page-number',
                render: props.showDynamic ? renderPageNumber : undefined,
              }),
            ],
          }),
        })
      },
    })

    const mounted = await mountPdfComponent(Fixture, {
      title: 'Before',
      showConditional: true,
      showDynamic: true,
      items: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ],
      titleStyle: { color: 'red' },
    })

    const document = mounted.document
    const page = elementChild(document, 0)
    const title = elementChild(page, 0)
    const initialTitleText = textChild(title)
    const initialA = page.children.find(
      child => 'props' in child && child.props.id === 'a',
    )
    const initialB = page.children.find(
      child => 'props' in child && child.props.id === 'b',
    )
    const dynamic = page.children.find(
      child => 'props' in child && child.props.id === 'page-number',
    ) as PdfElementNode

    expect(document).toMatchObject({
      type: PDF_PRIMITIVES.Document,
      box: {},
      props: { title: 'Renderer fixture' },
    })
    expect(page.type).toBe(PDF_PRIMITIVES.Page)
    expect(title.style).toEqual({ color: 'red' })
    expect(initialTitleText.value).toBe('Before')
    expect(dynamic.props.render).toBeTypeOf('function')
    expect(
      (dynamic.props.render as (props: { pageNumber: number }) => string)({
        pageNumber: 1,
      }),
    ).toBe('0')

    await mounted.update({
      title: 'After',
      showConditional: false,
      showDynamic: false,
      items: [
        { id: 'b', label: 'Beta updated' },
        { id: 'a', label: 'Alpha updated' },
      ],
      titleStyle: undefined,
    })

    const updatedPage = elementChild(mounted.document, 0)
    const updatedTitle = elementChild(updatedPage, 0)
    const updatedItems = updatedPage.children.filter(
      child => 'props' in child && ['a', 'b'].includes(child.props.id as string),
    ) as PdfElementNode[]
    const updatedDynamic = updatedPage.children.find(
      child => 'props' in child && child.props.id === 'page-number',
    ) as PdfElementNode

    expect(textChild(updatedTitle)).toBe(initialTitleText)
    expect(textChild(updatedTitle).value).toBe('After')
    expect(updatedTitle.style).toEqual({})
    expect(updatedPage.children).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ props: expect.objectContaining({ id: 'conditional' }) }),
    ]))
    expect(updatedItems.map(node => node.props.id)).toEqual(['b', 'a'])
    expect(updatedItems).toEqual([initialB, initialA])
    expect(updatedItems.map(node => textChild(node).value)).toEqual([
      'Beta updated',
      'Alpha updated',
    ])
    expect(updatedDynamic.props).not.toHaveProperty('render')

    const assertOnlyPdfNodes = (node: PdfElementNode) => {
      for (const child of node.children) {
        expect('type' in child).toBe(true)
        if ('children' in child) assertOnlyPdfNodes(child)
      }
    }

    assertOnlyPdfNodes(mounted.document)
    mounted.unmount()
    expect(mounted.root.document).toBeNull()
  })

  it('warns once and excludes orphan text', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfView, { id: 'orphan' }, () => 'not allowed'),
        }),
      }),
    )

    const mounted = await mountPdfComponent(Fixture)
    const orphanView = elementChild(elementChild(mounted.document, 0), 0)

    expect(orphanView.children).toEqual([])
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith(
      'Invalid \'not allowed\' string child outside <PdfText>.',
    )

    mounted.unmount()
  })

  it('rejects roots that do not contain exactly one document', async () => {
    const InvalidRoot = defineComponent(() => () => h(Fragment, null, [
      h(PdfDocument, { key: 'first' }),
      h(PdfDocument, { key: 'second' }),
    ]))

    await expect(mountPdfComponent(InvalidRoot)).rejects.toThrow(
      'A PDF component must render exactly one PdfDocument at its root.',
    )
  })
})
