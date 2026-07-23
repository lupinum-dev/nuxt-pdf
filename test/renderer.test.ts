import {
  Fragment,
  defineComponent,
  h,
  resolveComponent,
  type Component,
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
  PdfEllipse,
  PdfG,
  PdfImage,
  PdfLine,
  PdfLinearGradient,
  PdfLink,
  PdfNote,
  PdfPage,
  PdfPath,
  PdfPolygon,
  PdfPolyline,
  PdfRadialGradient,
  PdfRect,
  PdfStop,
  PdfSvg,
  PdfText,
  PdfTspan,
  PdfView,
} from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderDocument } from '../src/runtime/server/engine/render-document'
import {
  PDF_PRIMITIVES,
  type PdfElementNode,
  type PdfStyle,
  type PdfTextInstance,
} from '../src/runtime/renderer/types'
import { rasterizePdf } from './utils/pdf'

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

  it('paints the upstream layout debug overlay only when debug is enabled', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => [false, true].map(debug => h(PdfPage, {
          key: String(debug),
          size: [80, 80],
          style: { padding: 0 },
        }, {
          default: () => h(PdfView, {
            debug,
            style: {
              position: 'absolute',
              left: 20,
              top: 20,
              width: 40,
              height: 40,
            },
          }),
        })),
      }))
    const mounted = await mountPdfComponent(Fixture)

    try {
      const result = await renderDocument(
        mounted.document as unknown as DocumentNode,
      )
      const pages = await rasterizePdf(result.bytes)
      expect(pages).toHaveLength(2)

      const pixelAt = (page: (typeof pages)[number], x: number, y: number) => {
        const offset = ((y * page.width) + x) * 4
        return [...page.pixels.slice(offset, offset + 4)]
      }
      const plainCenter = pixelAt(pages[0]!, 40, 40)
      const debugCenter = pixelAt(pages[1]!, 40, 40)

      expect(plainCenter).toEqual([255, 255, 255, 255])
      expect(debugCenter).not.toEqual(plainCenter)
      expect(debugCenter[0]).toBeGreaterThan(245)
      expect(debugCenter[1]).toBeLessThan(10)
      expect(debugCenter[2]).toBeLessThan(10)
      expect(debugCenter[3]).toBe(255)
    }
    finally {
      mounted.unmount()
    }
  }, 20_000)

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

  it('normalizes ordinary kebab-case PDF props before mounting', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, { 'page-layout': 'singlePage' }, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfView, { 'min-presence-ahead': 48 }, {
            default: () => h(PdfNote, null, () => 'Reviewer note'),
          }),
        }),
      }),
    )

    const mounted = await mountPdfComponent(Fixture)
    const view = elementChild(elementChild(mounted.document, 0), 0)
    const note = elementChild(view, 0)

    expect(mounted.document.props.pageLayout).toBe('singlePage')
    expect(mounted.document.props).not.toHaveProperty('page-layout')
    expect(view.props.minPresenceAhead).toBe(48)
    expect(view.props).not.toHaveProperty('min-presence-ahead')
    expect(note.type).toBe(PDF_PRIMITIVES.Note)
    expect(textChild(note).value).toBe('Reviewer note')

    mounted.unmount()
  })

  it.each([
    { component: PdfDocument, prop: 'page-mode' },
    { component: PdfDocument, prop: 'modification-date' },
    { component: PdfDocument, prop: 'owner-password' },
    { component: PdfSvg, prop: 'preserve-aspect-ratio' },
    { component: PdfRect, prop: 'fill-rule' },
    { component: PdfLinearGradient, prop: 'gradient-units' },
    { component: PdfDefs, prop: 'anything' },
  ])('fails closed on removed or unknown $prop props', async ({ component, prop }) => {
    const secret = 'private-customer-value'
    const InvalidPrimitive = component as Component
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfSvg, { viewBox: '0 0 10 10' }, {
            default: () => h(InvalidPrimitive, { [prop]: secret }),
          }),
        }),
      }),
    )

    const error = await mountPdfComponent(Fixture).catch(cause => cause)
    expect(error).toMatchObject({ code: 'PDF_TREE_INVALID' })
    expect((error as Error).message).toContain(prop.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()))
    expect((error as Error).message).not.toContain(secret)
  })

  it('rejects a valid prop on the wrong primitive', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, { title: 'wrong host' }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Unsupported prop "title" on <PdfPage>.',
    })
  })

  it.each([
    {
      label: 'an image without a source',
      render: () => h(PdfImage as Component, {}),
      message: '<PdfImage> requires exactly one of "src" or "source".',
    },
    {
      label: 'an image with both source aliases',
      render: () => h(PdfImage as Component, {
        source: new Uint8Array([1]),
        src: new Uint8Array([2]),
      }),
      message: '<PdfImage> requires exactly one of "src" or "source".',
    },
    {
      label: 'a link without a target',
      render: () => h(PdfLink as Component, {}, () => 'invalid link'),
      message: '<PdfLink> requires exactly one of "href" or "src".',
    },
    {
      label: 'a link with both target aliases',
      render: () => h(PdfLink as Component, {
        href: 'https://example.com',
        src: '#details',
      }, () => 'invalid link'),
      message: '<PdfLink> requires exactly one of "href" or "src".',
    },
  ])('fails tree validation for $label', async ({ render, message }) => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, { default: render }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message,
    })
  })

  it.each([
    { label: 'zero dpi', props: { dpi: 0 } },
    { label: 'negative tuple width', props: { size: [-1, 100] } },
    { label: 'unknown page name', props: { size: 'invoice' } },
    { label: 'string boolean', props: { wrap: 'false' } },
  ])('rejects invalid page scalar: $label', async ({ props }) => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage as Component, props),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
    })
  })

  it('rejects SVG text paint on page-flow text', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfText as Component, { fill: '#f00' }, () => 'text'),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'The PdfText fill, x, and y props are only supported inside <PdfSvg>.',
    })
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
    { label: 'PdfPath.d', child: () => h(PdfPath as Component) },
    { label: 'PdfRect.height', child: () => h(PdfRect as Component, { width: 1 }) },
    { label: 'PdfCircle.r', child: () => h(PdfCircle as Component) },
    { label: 'PdfEllipse.ry', child: () => h(PdfEllipse as Component, { rx: 1 }) },
    {
      label: 'PdfLine.y2',
      child: () => h(PdfLine as Component, { x1: 0, x2: 1, y1: 0 }),
    },
    { label: 'PdfPolyline.points', child: () => h(PdfPolyline as Component) },
    { label: 'PdfPolygon.points', child: () => h(PdfPolygon as Component) },
    {
      label: 'PdfClipPath.id',
      child: () => h(PdfDefs, null, {
        default: () => h(PdfClipPath as Component),
      }),
    },
    {
      label: 'PdfLinearGradient.id',
      child: () => h(PdfDefs, null, {
        default: () => h(PdfLinearGradient as Component),
      }),
    },
    {
      label: 'PdfRadialGradient.id',
      child: () => h(PdfDefs, null, {
        default: () => h(PdfRadialGradient as Component),
      }),
    },
    {
      label: 'PdfStop.stopColor',
      child: () => h(PdfDefs, null, {
        default: () => h(PdfLinearGradient, { id: 'g' }, {
          default: () => h(PdfStop as Component, { offset: 0 }),
        }),
      }),
    },
  ])('fails closed when $label is missing', async ({ child }) => {
    await expect(mountSvgSubtree(child)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
    })
  })

  it('treats numeric zero as present for required SVG props', async () => {
    const mounted = await mountSvgSubtree(() => [
      h(PdfRect, { height: 0, width: 0 }),
      h(PdfCircle, { r: 0 }),
      h(PdfEllipse, { rx: 0, ry: 0 }),
      h(PdfLine, { x1: 0, x2: 0, y1: 0, y2: 0 }),
      h(PdfPolyline, { points: '0,0 0,0' }),
      h(PdfPolygon, { points: '0,0 0,0 0,0' }),
      h(PdfDefs, null, {
        default: () => h(PdfLinearGradient, { id: 'zero-gradient' }, {
          default: () => h(PdfStop, { offset: 0, stopColor: '#000' }),
        }),
      }),
    ])

    expect(svgOf(mounted).children).toHaveLength(7)
    mounted.unmount()
  })

  it.each([
    { label: 'malformed viewBox', svg: { viewBox: '0 0 nope 10' }, child: () => null },
    {
      label: 'negative stroke width',
      svg: { viewBox: '0 0 10 10' },
      child: () => h(PdfLine as Component, {
        strokeWidth: -1,
        x1: 0,
        x2: 1,
        y1: 0,
        y2: 1,
      }),
    },
    {
      label: 'opacity above one',
      svg: { viewBox: '0 0 10 10' },
      child: () => h(PdfRect as Component, {
        fillOpacity: 1.1,
        height: 1,
        width: 1,
      }),
    },
    {
      label: 'nonnumeric geometry',
      svg: { viewBox: '0 0 10 10' },
      child: () => h(PdfRect as Component, {
        height: 1,
        width: 'large',
      }),
    },
    {
      label: 'unsupported transform',
      svg: { viewBox: '0 0 10 10' },
      child: () => h(PdfRect as Component, {
        height: 1,
        transform: 'skewX(10)',
        width: 1,
      }),
    },
  ])('rejects $label', async ({ svg, child }) => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfSvg as Component, svg, { default: child }),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
    })
  })

  it('scopes definition ids to each Svg instead of destination ids', async () => {
    const definition = () => h(PdfDefs, null, {
      default: () => h(PdfLinearGradient, { id: 'shared' }),
    })
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, { id: 'shared' }, {
          default: () => [
            h(PdfSvg, { key: 'first', viewBox: '0 0 10 10' }, { default: definition }),
            h(PdfSvg, { key: 'second', viewBox: '0 0 10 10' }, { default: definition }),
          ],
        }),
      }),
    )

    const mounted = await mountPdfComponent(Fixture)
    mounted.unmount()
  })

  it('rejects duplicate definition ids inside one Svg', async () => {
    await expect(mountSvgSubtree(() => h(PdfDefs, null, {
      default: () => [
        h(PdfLinearGradient, { id: 'duplicate' }),
        h(PdfRadialGradient, { id: 'duplicate' }),
      ],
    }))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'SVG definition ids must be unique within one <PdfSvg>.',
    })
  })

  it('rejects more than one Defs child inside one Svg', async () => {
    await expect(mountSvgSubtree(() => [
      h(PdfDefs, { key: 'first' }),
      h(PdfDefs, { key: 'second' }),
    ])).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: '<PdfSvg> accepts at most one <PdfDefs> child.',
    })
  })

  it.each([
    {
      label: 'dangling fill',
      child: () => h(PdfRect, {
        fill: 'url(#missing)',
        height: 1,
        width: 1,
      }),
    },
    {
      label: 'gradient used as clip path',
      child: () => [
        h(PdfDefs, { key: 'defs' }, {
          default: () => h(PdfLinearGradient, { id: 'paint' }),
        }),
        h(PdfRect, {
          key: 'shape',
          clipPath: 'url(#paint)',
          height: 1,
          width: 1,
        }),
      ],
    },
  ])('rejects a $label reference', async ({ child }) => {
    await expect(mountSvgSubtree(child)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
    })
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
        h(PdfText, { key: 'text', x: 0, y: 0 }, {
          default: () => h(PdfTspan, null, () => 'kept'),
        }),
        h(PdfTspan, { key: 'orphan' }, () => 'dropped'),
      ],
    }))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Invalid PDF nesting: <PdfG> cannot contain <PdfTspan>.',
    })
  })

  it('rejects Tspan inside ordinary page-flow text', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfText, null, {
            default: () => h(PdfTspan, null, () => 'not SVG text'),
          }),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: '<PdfTspan> is only supported inside SVG text.',
    })
  })

  it.each([
    { label: 'missing coordinates', props: { fill: '#f00' } },
    { label: 'page-flow prop', props: { fixed: true, x: 0, y: 0 } },
  ])('rejects SVG text with $label', async ({ props }) => {
    await expect(mountSvgSubtree(() =>
      h(PdfText as Component, props, () => 'invalid SVG text'),
    )).rejects.toMatchObject({ code: 'PDF_TREE_INVALID' })
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

  it('preserves numeric zero fill opacity for layout to resolve', async () => {
    const mounted = await mountSvgSubtree(() => h(PdfRect, {
      width: 10,
      height: 10,
      fillOpacity: 0,
    }))

    expect(elementChild(svgOf(mounted), 0).props.fillOpacity).toBe(0)
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
