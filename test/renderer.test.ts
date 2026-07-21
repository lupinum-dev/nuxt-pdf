import {
  Fragment,
  defineComponent,
  h,
  resolveComponent,
  type PropType,
  type VNodeChild,
} from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FontStore from '@react-pdf/font'
import layoutDocument, {
  type DocumentNode,
  type SafeDocumentNode,
} from '@react-pdf/layout'
import * as UpstreamPrimitives from '@react-pdf/primitives'
import {
  PdfCircle,
  PdfClipPath,
  PdfDefs,
  PdfDocument,
  PdfG,
  PdfLinearGradient,
  PdfNote,
  PdfPage,
  PdfPath,
  PdfRect,
  PdfStop,
  PdfSvg,
  PdfText,
  PdfTspan,
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
      Tspan: UpstreamPrimitives.Tspan,
      Svg: UpstreamPrimitives.Svg,
      G: UpstreamPrimitives.G,
      Path: UpstreamPrimitives.Path,
      Rect: UpstreamPrimitives.Rect,
      Circle: UpstreamPrimitives.Circle,
      Ellipse: UpstreamPrimitives.Ellipse,
      Line: UpstreamPrimitives.Line,
      Polyline: UpstreamPrimitives.Polyline,
      Polygon: UpstreamPrimitives.Polygon,
      Defs: UpstreamPrimitives.Defs,
      ClipPath: UpstreamPrimitives.ClipPath,
      LinearGradient: UpstreamPrimitives.LinearGradient,
      RadialGradient: UpstreamPrimitives.RadialGradient,
      Stop: UpstreamPrimitives.Stop,
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

  it('fails closed on orphan text without echoing document content', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfView, { id: 'orphan' }, () => 'private customer text'),
        }),
      }),
    )

    const error = await mountPdfComponent(Fixture).catch(cause => cause)
    expect(error).toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: '<PdfView> cannot contain text. Wrap it in <PdfText>.',
    })
    expect((error as Error).message).not.toContain('private customer text')
  })

  it('ignores formatting whitespace outside text containers', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfView, null, () => ' \n  '),
        }),
      }),
    )

    const mounted = await mountPdfComponent(Fixture)
    expect(elementChild(elementChild(mounted.document, 0), 0).children)
      .toEqual([])
    mounted.unmount()
  })

  it('fails closed on unsupported primitive nesting', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfView, null, {
            default: () => [
              h(PdfPage, { key: 'invalid-page' }),
              h(PdfText, { key: 'valid-text' }, () => 'Still valid'),
            ],
          }),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Invalid PDF nesting: <PdfView> cannot contain <PdfPage>.',
    })
  })

  it('does not downgrade invalid nesting when a warning sink is provided', async () => {
    const warn = vi.fn()
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfView, null, {
            default: () => h(PdfPage, { key: 'invalid-page' }),
          }),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture, {}, warn)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('rejects duplicate destination ids without echoing the identifier', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => [
            h(PdfView, { id: 'private-customer-id' }),
            h(PdfText, { id: 'private-customer-id' }, () => 'Duplicate'),
          ],
        }),
      }),
    )

    const error = await mountPdfComponent(Fixture).catch(cause => cause)
    expect(error).toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'PDF destination ids must be unique within a document.',
    })
    expect((error as Error).message).not.toContain('private-customer-id')
  })

  it.each([
    '',
    '   ',
    '__proto__',
    'constructor',
    'prototype',
  ])('rejects unsafe destination id %j', async (id) => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfText, { id }, () => 'Destination'),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
    })
  })

  it.each([
    'aria-label',
    'class',
    'data-testid',
    'role',
  ])('rejects the DOM-only "$attribute" attribute', async (attribute) => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfText, {
            [attribute]: 'web-only',
          }, () => 'PDF text'),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toThrow(
      `DOM-only attribute "${attribute}" is not supported on <PdfText>. Use PDF props and styles instead.`,
    )
  })

  it('retains PdfNote text and minPresenceAhead on the canonical tree', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfView, { minPresenceAhead: 48 }, {
            default: () => h(PdfNote, null, () => 'Reviewer note'),
          }),
        }),
      }),
    )

    const mounted = await mountPdfComponent(Fixture)
    const view = elementChild(elementChild(mounted.document, 0), 0)
    const note = elementChild(view, 0)

    expect(view.props.minPresenceAhead).toBe(48)
    expect(note.type).toBe(PDF_PRIMITIVES.Note)
    expect(textChild(note).value).toBe('Reviewer note')

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

describe('Vue PDF SVG nesting', () => {
  const mountSvgSubtree = (child: () => VNodeChild) => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfSvg, { viewBox: '0 0 100 100' }, {
            default: child,
          }),
        }),
      }),
    )
    return mountPdfComponent(Fixture)
  }

  const svgOf = (mounted: { document: PdfElementNode }): PdfElementNode =>
    elementChild(elementChild(mounted.document, 0), 0)

  it('accepts shapes, groups, defs, and text inside an Svg', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mounted = await mountSvgSubtree(() => [
      h(PdfPath, { d: 'M0 0 L10 10' }),
      h(PdfRect, { x: 0, y: 0, width: 10, height: 10 }),
      h(PdfCircle, { cx: 5, cy: 5, r: 4 }),
      h(PdfG, null, { default: () => h(PdfRect, { width: 2, height: 2 }) }),
      h(PdfDefs, null, {
        default: () => h(PdfClipPath, { id: 'c' }, {
          default: () => h(PdfCircle, { cx: 1, cy: 1, r: 1 }),
        }),
      }),
      h(PdfText, { x: 1, y: 1 }, () => 'label'),
    ])

    const svg = svgOf(mounted)
    expect(svg.type).toBe(PDF_PRIMITIVES.Svg)
    expect(svg.children.map(child => (child as PdfElementNode).type)).toEqual([
      PDF_PRIMITIVES.Path,
      PDF_PRIMITIVES.Rect,
      PDF_PRIMITIVES.Circle,
      PDF_PRIMITIVES.G,
      PDF_PRIMITIVES.Defs,
      PDF_PRIMITIVES.Text,
    ])
    expect(warning).not.toHaveBeenCalled()

    mounted.unmount()
  })

  it.each([
    { host: 'PdfPage', wrap: false },
    { host: 'PdfView', wrap: true },
  ])('accepts an Svg as a child of $host', async ({ wrap }) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const svg = () => h(PdfSvg, { viewBox: '0 0 10 10' }, {
      default: () => h(PdfRect, { width: 5, height: 5 }),
    })
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => (wrap ? h(PdfView, null, { default: svg }) : svg()),
        }),
      }),
    )

    const mounted = await mountPdfComponent(Fixture)
    const page = elementChild(mounted.document, 0)
    const svgNode = wrap ? elementChild(elementChild(page, 0), 0) : elementChild(page, 0)

    expect(svgNode.type).toBe(PDF_PRIMITIVES.Svg)
    expect(warning).not.toHaveBeenCalled()

    mounted.unmount()
  })

  it('rejects Defs inside a G', async () => {
    await expect(mountSvgSubtree(() => h(PdfG, null, {
      default: () => [
        h(PdfRect, { key: 'kept', width: 1, height: 1 }),
        h(PdfDefs, { key: 'dropped' }),
      ],
    }))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Invalid PDF nesting: <PdfG> cannot contain <PdfDefs>.',
    })
  })

  it('rejects Tspan outside Text, where upstream would draw nothing', async () => {
    await expect(mountSvgSubtree(() => h(PdfG, null, {
      default: () => [
        h(PdfText, { key: 'text' }, {
          default: () => h(PdfTspan, null, () => 'kept'),
        }),
        h(PdfTspan, { key: 'orphan' }, () => 'dropped'),
      ],
    }))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Invalid PDF nesting: <PdfG> cannot contain <PdfTspan>.',
    })
  })

  it('lets Defs hold gradients and clip paths but rejects raw shapes', async () => {
    await expect(mountSvgSubtree(() => h(PdfDefs, null, {
      default: () => [
        h(PdfLinearGradient, { key: 'grad', id: 'g' }),
        h(PdfClipPath, { key: 'clip', id: 'c' }),
        h(PdfRect, { key: 'raw', width: 1, height: 1 }),
      ],
    }))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Invalid PDF nesting: <PdfDefs> cannot contain <PdfRect>.',
    })
  })

  it('lets ClipPath hold shapes but rejects text', async () => {
    await expect(mountSvgSubtree(() => h(PdfDefs, null, {
      default: () => h(PdfClipPath, { id: 'c' }, {
        default: () => [
          h(PdfRect, { key: 'kept', width: 1, height: 1 }),
          h(PdfText, { key: 'dropped' }, () => 'no text in clip'),
        ],
      }),
    }))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Invalid PDF nesting: <PdfClipPath> cannot contain <PdfText>.',
    })
  })

  it('restricts gradients to Stop children', async () => {
    await expect(mountSvgSubtree(() => h(PdfDefs, null, {
      default: () => h(PdfLinearGradient, { id: 'g' }, {
        default: () => [
          h(PdfStop, { key: 'kept', offset: '0', stopColor: '#000' }),
          h(PdfRect, { key: 'dropped', width: 1, height: 1 }),
        ],
      }),
    }))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Invalid PDF nesting: <PdfLinearGradient> cannot contain <PdfRect>.',
    })
  })

  it('rejects an Svg placed directly inside a PdfText', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfText, null, {
            default: () => h(PdfSvg, { key: 'dropped', viewBox: '0 0 1 1' }),
          }),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Invalid PDF nesting: <PdfText> cannot contain <PdfSvg>.',
    })
  })

  it('coerces kebab-case SVG attributes to the camelCase engine props', async () => {
    const mounted = await mountSvgSubtree(() => h(PdfRect, {
      'width': 10,
      'height': 10,
      'stroke-width': 2,
      'fill-opacity': '0.5',
      'stroke-linecap': 'round',
    }))

    const rect = elementChild(svgOf(mounted), 0)
    expect(rect.props).toMatchObject({
      width: 10,
      height: 10,
      strokeWidth: 2,
      fillOpacity: '0.5',
      strokeLinecap: 'round',
    })
    expect(rect.props).not.toHaveProperty('stroke-width')

    mounted.unmount()
  })

  it('keeps leaf shapes childless even when given slotted content', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mounted = await mountSvgSubtree(() => h(PdfPath, { d: 'M0 0 L1 1' }, {
      default: () => h(PdfRect, { width: 1, height: 1 }),
    }))

    const path = elementChild(svgOf(mounted), 0)
    expect(path.type).toBe(PDF_PRIMITIVES.Path)
    expect(path.children).toEqual([])
    expect(warning).not.toHaveBeenCalled()

    mounted.unmount()
  })
})
