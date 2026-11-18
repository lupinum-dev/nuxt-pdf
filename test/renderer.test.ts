import {
  Comment,
  Fragment,
  defineAsyncComponent,
  defineComponent,
  h,
  nextTick,
  onBeforeMount,
  onBeforeUnmount,
  onMounted,
  onServerPrefetch,
  onUnmounted,
  onUpdated,
  reactive,
  ref,
  resolveComponent,
  shallowRef,
  vShow,
  watchEffect,
  withDirectives,
  type Component,
  type PropType,
  type VNodeChild,
} from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FontStore from '@react-pdf/font'
import layoutDocument, {
  type DocumentNode,
  type SafeDocumentNode,
} from '../src/runtime/server/engine/layout/index'
import * as UpstreamPrimitives from '@react-pdf/primitives'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderDocument } from '../src/runtime/server/engine/render-document'
import type { PdfStyle } from '../src/runtime/authoring'
import {
  PDF_PRIMITIVE_COMPONENT_NAMES,
  PDF_PRIMITIVE_TABLE,
  PDF_PRIMITIVES,
  type PdfPrimitiveName,
} from '../src/runtime/primitives'
import { PDF_SOURCE_PROP } from '../src/runtime/shared/template'
import type {
  PdfElementNode,
  PdfTextInstance,
} from '../src/runtime/renderer/types'
import { renderPdfTemplate } from '../src/test'
import { rasterizePdf } from '../src/test/pdf'

const { PdfCircle, PdfClipPath, PdfDefs, PdfDocument, PdfEllipse, PdfG, PdfImage, PdfLine, PdfLinearGradient, PdfLink, PdfNote, PdfPage, PdfPath, PdfPolygon, PdfPolyline, PdfRadialGradient, PdfRect, PdfPageNumber, PdfStop, PdfSvg, PdfText, PdfTspan, PdfView } = PDF_COMPONENTS

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

// Re-renders a mounted template with new props, the way a component's own
// reactive state does before the tree is taken (an onMounted change, say).
const mountWithProps = async (component: Component, initial: Record<string, unknown>) => {
  const props = shallowRef(initial)
  const mounted = await mountPdfComponent(defineComponent(() => () => h(component, props.value)))
  const setProps = async (next: Record<string, unknown>) => {
    props.value = next
    await nextTick()
  }
  return { mounted, setProps }
}

describe('Vue PDF host renderer', () => {
  it('uses runtime-core lifecycle semantics in Node', async () => {
    const events: string[] = []
    const value = ref('first')
    const Fixture = defineComponent({
      setup() {
        onBeforeMount(() => events.push('beforeMount'))
        onMounted(() => events.push('mounted'))
        onUpdated(() => events.push('updated'))
        onBeforeUnmount(() => events.push('beforeUnmount'))
        onUnmounted(() => events.push('unmounted'))
        onServerPrefetch(() => {
          events.push('serverPrefetch')
        })
        return () => {
          const text = value.value
          return h(PdfDocument, null, {
            default: () => h(PdfPage, null, {
              default: () => h(PdfText, null, () => text),
            }),
          })
        }
      },
    })

    const mounted = await mountPdfComponent(Fixture)
    value.value = 'second'
    await nextTick()
    mounted.unmount()

    expect(events).toEqual([
      'beforeMount',
      'mounted',
      'updated',
      'beforeUnmount',
      'unmounted',
    ])
  })

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
                hyphenate: props.showDynamic ? false : undefined,
              }, () => 'Long words stay whole'),
            ],
          }),
        })
      },
    })

    const { mounted, setProps } = await mountWithProps(Fixture, {
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
    expect(dynamic.props.hyphenate).toBe(false)

    await setProps({
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
    expect(updatedDynamic.props).not.toHaveProperty('hyphenate')

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

  it('keeps sibling order through keyed moves, inserts, and removals', async () => {
    const Fixture = defineComponent({
      props: {
        ids: { type: Array as PropType<number[]>, required: true },
      },
      setup: props => () => h(PdfDocument, null, () => h(PdfPage, null, () => [
        h(PdfText, { id: 'head' }, () => 'Head'),
        h(Fragment, null, props.ids.map(id =>
          h(PdfText, { id: `row-${id}`, key: id }, () => `Row ${id}`))),
        h(PdfText, { id: 'tail' }, () => 'Tail'),
      ])),
    })
    const pageIds = (mounted: Awaited<ReturnType<typeof mountPdfComponent>>) =>
      elementChild(mounted.document, 0).children.map(
        child => (child as PdfElementNode).props.id,
      )
    const expected = (ids: number[]) =>
      ['head', ...ids.map(id => `row-${id}`), 'tail']

    const initial = Array.from({ length: 40 }, (_, index) => index)
    const { mounted, setProps } = await mountWithProps(Fixture, { ids: initial })
    expect(pageIds(mounted)).toEqual(expected(initial))

    // Reverse, drop every third row, and add new rows at both ends and inside.
    const next = [100, ...initial.toReversed().filter(id => id % 3 !== 0), 101]
    next.splice(10, 0, 102)
    await setProps({ ids: next })
    expect(pageIds(mounted)).toEqual(expected(next))

    await setProps({ ids: [] })
    expect(pageIds(mounted)).toEqual(expected([]))
    mounted.unmount()
  })

  // Catches a linked list that loses, duplicates, or misorders nodes when Vue
  // moves a keyed fragment: it inserts the start anchor, each child, and the end
  // anchor one by one before a sibling that may itself be a fragment anchor.
  it('keeps order when keyed fragments move between keyed fragments', async () => {
    const Fixture = defineComponent({
      props: {
        ids: { type: Array as PropType<number[]>, required: true },
      },
      setup: props => () => h(PdfDocument, null, () => h(PdfPage, null, () =>
        h(PdfView, null, () => props.ids.map(id => h(Fragment, { key: id }, [
          h(PdfText, { id: `a-${id}` }, () => `A ${id}`),
          h(PdfText, { id: `b-${id}` }, () => `B ${id}`),
        ]))))),
    })
    const listIds = (mounted: Awaited<ReturnType<typeof mountPdfComponent>>) =>
      elementChild(elementChild(mounted.document, 0), 0).children.map(
        child => (child as PdfElementNode).props.id,
      )
    const expected = (ids: number[]) => ids.flatMap(id => [`a-${id}`, `b-${id}`])

    // A fixed linear congruential sequence keeps the permutations reproducible.
    let seed = 7
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648
    const shuffled = (ids: number[]) => ids
      .map(id => ({ id, order: random() }))
      .toSorted((left, right) => left.order - right.order)
      .map(({ id }) => id)

    let ids = Array.from({ length: 30 }, (_, index) => index)
    const { mounted, setProps } = await mountWithProps(Fixture, { ids })
    expect(listIds(mounted)).toEqual(expected(ids))

    for (let round = 0; round < 20; round++) {
      ids = shuffled([...ids.filter(() => random() > 0.2), 100 + round * 3, 101 + round * 3])
      await setProps({ ids })
      expect(listIds(mounted)).toEqual(expected(ids))
    }
    mounted.unmount()
  })

  it('mounts 16,000 sibling rows in linear time', async () => {
    const rows = 16_000
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, () => h(PdfPage, null, () => h(PdfView, null, () =>
        Array.from({ length: rows }, (_, index) =>
          h(PdfView, { key: index }, () => h(PdfText, null, () => `Row ${index}`)))))))

    const start = performance.now()
    const mounted = await mountPdfComponent(Fixture)
    const elapsed = performance.now() - start

    const list = elementChild(elementChild(mounted.document, 0), 0)
    expect(list.children).toHaveLength(rows)
    expect(textChild(elementChild(elementChild(list, rows - 1), 0)).value)
      .toBe(`Row ${rows - 1}`)
    // Rebuilding the children array on every insert took 36 s here; the linear
    // mount takes about 0.4 s. The bound leaves room for a loaded CI machine.
    expect(elapsed).toBeLessThan(5_000)
    mounted.unmount()
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

  // Wrong behavior caught: a migration hint that leads to the next error (wrap
  // the token inside the link that sits in a text), that is missing (a token
  // in a view), or that omits pages for a render callback that hid content on
  // some pages.
  it.each([
    {
      label: 'the removed render prop',
      child: () => h(PdfText as Component, { fixed: true, render: () => 'Page 1' }),
      message: 'Unsupported prop "render" on <PdfText>. Use <PdfPageNumber /> and <PdfPageCount /> inside the text. Use pages="first" or pages="continuation" on a fixed text to show it on some pages only.',
    },
    {
      label: 'a page token in a link inside a text',
      child: () => h(PdfText, { fixed: true }, () => [
        h(PdfLink, { href: 'https://example.com/' }, () => h(PdfPageNumber)),
        ' Head',
      ]),
      message: 'Invalid PDF nesting: <PdfLink> cannot contain <PdfPageNumber>. Wrap it in <PdfText>. Keep that <PdfLink> outside any other text: <PdfLink><PdfText>… <PdfPageNumber /></PdfText></PdfLink>.',
    },
    {
      label: 'a page token directly in a view',
      child: () => h(PdfView, { fixed: true }, () => h(PdfPageNumber)),
      message: 'Invalid PDF nesting: <PdfView> cannot contain <PdfPageNumber>. Put it inside a <PdfText>.',
    },
  ])('rejects $label with a hint that leads to valid markup', async ({ child, message }) => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, () => h(PdfPage, null, child)))

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message,
    })
  })

  // Catches a hint whose suggested markup does not render.
  it('renders the markup the page-token link hint suggests', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, () => h(PdfPage, null, () => h(PdfView, { fixed: true }, () =>
        h(PdfLink, { href: 'https://example.com/' }, () =>
          h(PdfText, null, () => ['Page ', h(PdfPageNumber)]))))))

    await expect(renderPdfTemplate(Fixture, {})).resolves.toMatchObject({ bytes: expect.any(Uint8Array) })
  })

  it.each([
    {
      label: 'prop validation',
      child: () => h(PdfText as Component, { class: 'invalid' }, () => 'text'),
    },
    {
      label: 'nesting validation',
      child: () => h(PdfView, null, {
        default: () => h(PdfPage),
      }),
    },
    {
      label: 'element text validation',
      child: () => h(PdfView, null, () => 'invalid text'),
    },
  ])('disposes reactive effects after failed $label', async ({ child }) => {
    const source = ref(0)
    const effectRuns = vi.fn()
    const unmounted = vi.fn()
    const Fixture = defineComponent({
      setup() {
        watchEffect(() => {
          void source.value
          effectRuns()
        })
        onUnmounted(unmounted)

        return () => h(PdfDocument, null, {
          default: () => h(PdfPage, null, { default: child }),
        })
      },
    })

    await expect(mountPdfComponent(Fixture)).rejects.toBeInstanceOf(Error)
    expect(effectRuns).toHaveBeenCalledOnce()
    expect(unmounted).toHaveBeenCalledOnce()

    source.value++
    await nextTick()
    expect(effectRuns).toHaveBeenCalledOnce()
  })

  it('rejects component errors instead of returning partial content', async () => {
    const BrokenChild = defineComponent({
      render() {
        throw new Error('private component failure')
      },
    })
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => [
            h(PdfText, { key: 'before' }, () => 'Before'),
            h(BrokenChild, { key: 'broken' }),
            h(PdfText, { key: 'after' }, () => 'After'),
          ],
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toThrow(
      'private component failure',
    )
  })

  it.each([
    {
      label: 'async setup',
      component: defineComponent({
        async setup() {
          await Promise.resolve()
          return () => h(PdfText, null, () => 'Late setup content')
        },
      }),
    },
    {
      label: 'an async component',
      component: defineAsyncComponent(async () => {
        await Promise.resolve()
        return defineComponent(() => () =>
          h(PdfText, null, () => 'Late component content'),
        )
      }),
    },
  ])('rejects $label instead of omitting its content', async ({ component }) => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(component),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TEMPLATE_INVALID',
      message: expect.stringContaining('Async setup and async components'),
    })
  })

  it('rejects DOM directives that mutate undeclared PDF styles', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => withDirectives(
            h(PdfText, null, () => 'Hidden content'),
            [[vShow, false]],
          ),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Unsupported PDF style "display" on <PdfText>.',
    })
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

  // The later invalid prop also catches a nesting check deferred past mount:
  // the first defect in mount order must stay the reported one.
  it('fails closed on unsupported primitive nesting', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => [
            h(PdfView, null, {
              default: () => [
                h(PdfPage, { key: 'invalid-page' }),
                h(PdfText, { key: 'valid-text' }, () => 'Still valid'),
              ],
            }),
            h(PdfImage as Component, { src: 'logo.png', title: 'later defect' }),
          ],
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Invalid PDF nesting: <PdfView> cannot contain <PdfPage>.',
    })
  })

  // The message names the id and both elements (slice V1; it left the id
  // out before), so the author finds them without a source position.
  it('rejects duplicate destination ids and names both elements', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => [
            h(PdfView, { id: 'section-2' }),
            h(PdfText, { id: 'section-2' }, () => 'Duplicate'),
          ],
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: '<PdfView id="section-2"> and <PdfText id="section-2"> have the same id; ids must be unique within a document.',
    })
  })

  it('rejects a document with no PdfPage', async () => {
    const Fixture = defineComponent(() => () => h(PdfDocument))

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: '<PdfDocument> requires at least one <PdfPage>.',
    })
  })

  it('rejects a missing internal destination', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfLink, { href: '#missing' }, () => 'Broken'),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: '<PdfLink> internal destination does not match any id in the document.',
    })
  })

  it('rejects empty internal destination fragments', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfLink, { href: '#' }, () => 'Empty'),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: '<PdfLink> internal destinations must name a non-empty id.',
    })
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

  // A class that bypasses the SFC compiler (render function, v-bind object)
  // must fail and point to the <style> block, not vanish.
  it('rejects a class that did not come from a compiled template', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfText, { class: 'title' }, () => 'PDF text'),
        }),
      }),
    )

    await expect(mountPdfComponent(Fixture)).rejects.toThrow(
      'Unsupported "class" on <PdfText>. Classes come from the <style> block of a PDF component',
    )
  })

  it('normalizes ordinary kebab-case PDF props before mounting', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, { 'page-layout': 'singlePage' }, {
        default: () => h(PdfPage, null, {
          // A bare boolean attribute in a template (`<PdfView fixed>`) arrives as ''.
          default: () => h(PdfView as Component, { 'min-presence-ahead': 48, 'fixed': '' }, {
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
    expect(view.props.fixed).toBe(true)
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

  // Catches Vue proxies left in the tree: postMessage to the render worker
  // throws DataCloneError on a reactive style or prop object.
  it('stores plain copies of reactive props and styles', async () => {
    const style = reactive({ color: 'red', margin: 4 })
    const bookmark = reactive({ title: 'Start', expanded: true })
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, () => h(PdfPage, null, () =>
        h(PdfView, { style, bookmark }, () => h(PdfText, null, () => 'Body')))))

    const mounted = await mountPdfComponent(Fixture)
    const view = elementChild(elementChild(mounted.document, 0), 0)

    expect(() => structuredClone(mounted.document)).not.toThrow()
    expect(view.style).toEqual({ color: 'red', margin: 4 })
    expect(view.props.bookmark).toEqual({ title: 'Start', expanded: true })
    style.margin = 9
    expect(view.style).toEqual({ color: 'red', margin: 4 })
    mounted.unmount()
  })

  // Catches a non-cloneable value that would only fail later, in postMessage,
  // without naming where it came from.
  it.each([
    {
      label: 'a function inside a style',
      props: { style: { color: () => 'red' } },
      message: 'The "style" prop on <PdfView> must be plain data: it contains a function.',
    },
    {
      label: 'a class instance',
      props: { bookmark: new (class Bookmark { title = 'x' })() },
      message: 'The "bookmark" prop on <PdfView> must be plain data: it contains a class instance.',
    },
    {
      label: 'a circular object',
      props: { style: (() => {
        const value: Record<string, unknown> = { color: 'red' }
        value.self = value
        return value
      })() },
      message: 'The "style" prop on <PdfView> must be plain data: it contains a circular reference.',
    },
  ])('rejects $label in a prop with PDF_TREE_INVALID', async ({ props, message }) => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, () => h(PdfPage, null, () =>
        h(PdfView as Component, props))))

    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message,
    })
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
      message: '<PdfImage> requires a "src" prop.',
    },
    {
      label: 'an image with the removed source alias',
      render: () => h(PdfImage as Component, {
        source: new Uint8Array([1]),
      }),
      message: 'Unsupported prop "source" on <PdfImage>.',
    },
    {
      label: 'a link without a target',
      render: () => h(PdfLink as Component, {}, () => 'invalid link'),
      message: '<PdfLink> requires an "href" prop.',
    },
    {
      label: 'a link with the removed src alias',
      render: () =>
        h(PdfLink as Component, { src: '#missing' }, () => 'invalid link'),
      message: 'Unsupported prop "src" on <PdfLink>.',
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
      message: '<PdfText> takes "fill", "x" and "y" only inside <PdfSvg>.',
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

// V1 to V7 (internals/harness-r1/v1-validator-gaps.md): every message names
// the element, its id when it has one, the prop or style key and the wrong
// value, so the author finds the element without a source position; values
// that rendered silently before now fail.
describe('tree validation messages', () => {
  // The fixtures pass wrong values on purpose, which the typed props reject,
  // so the components are used as plain Vue components here.
  const PLAIN: Readonly<Record<keyof typeof PDF_COMPONENTS, Component>> = PDF_COMPONENTS
  const { PdfDocument, PdfPage, PdfText, PdfView } = PLAIN
  const documentWith = (children: () => VNodeChild, documentProps: Record<string, unknown> = {}) =>
    defineComponent(() => () => h(PdfDocument, documentProps, {
      default: () => h(PdfPage, null, { default: children }),
    }))

  it.each([
    ['an unknown style key', () => h(PdfText, { id: 'intro', style: { colour: 'red' } }, () => 'x'), {}, 'Unsupported PDF style "colour" on <PdfText id="intro">.'],
    ['a style value in a wrong unit', () => h(PdfView, { style: { marginTop: '3furlong' } }), {}, '<PdfView> :style value "3furlong" for "marginTop" is invalid: expected a number of points, a length such as 12pt, a percentage or auto.'],
    ['a negative font size', () => h(PdfText, { style: { fontSize: -4 } }, () => 'x'), {}, '<PdfText> :style value -4 for "fontSize" is invalid: expected a value of 0 or more.'],
    ['a negative part of a padding shorthand', () => h(PdfView, { style: { padding: '4pt -2pt' } }), {}, '<PdfView> :style value "4pt -2pt" for "padding" is invalid: expected a value of 0 or more.'],
    ['an opacity above 1', () => h(PdfView, { style: [{ opacity: 0.5 }, { opacity: 1.5 }] }), {}, '<PdfView> :style value 1.5 for "opacity" is invalid: expected a number from 0 to 1.'],
    ['an empty id', () => h(PdfText, { id: ' ' }, () => 'x'), {}, '<PdfText> "id" must be a non-empty string. Got " ".'],
    ['an id that is not a string', () => h(PdfView, { id: 42 }), {}, '<PdfView> "id" must be a non-empty string. Got 42.'],
    ['a reserved id', () => h(PdfText, { id: '__proto__' }, () => 'x'), {}, '<PdfText id="__proto__"> uses a reserved identifier as its id; use another id.'],
    ['a duplicate id', () => [h(PdfView, { id: 'intro' }), h(PdfText, { id: 'intro' }, () => 'x')], {}, '<PdfView id="intro"> and <PdfText id="intro"> have the same id; ids must be unique within a document.'],
    ['a Vue event prop', () => h(PdfText, { onClick: () => undefined }, () => 'x'), {}, 'Vue event prop "onClick" is not supported on <PdfText>: a PDF has no events.'],
    ['a long wrong value, cut at 40 characters', () => h(PdfText, { tag: 'h'.repeat(60) }, () => 'x'), {}, `<PdfText> requires "tag" to be "h1", "h2", "h3", "h4", "h5", "h6" or "p". Got "${'h'.repeat(37)}...".`],
    ['a bookmark that is a number', () => h(PdfText, { bookmark: 42 }, () => 'x'), {}, '<PdfText> requires "bookmark" to be a title string or { title: string, expanded?: boolean }. Got 42.'],
    ['a bookmark with an unknown key', () => h(PdfView, { bookmark: { title: 'Part', open: true } }), {}, '<PdfView> requires "bookmark" to be a title string or { title: string, expanded?: boolean }. Got an object.'],
    ['a title that is not a string', () => h(PdfText, () => 'x'), { title: 42 }, '<PdfDocument> requires a string "title" value. Got 42.'],
    ['a language that is not a string', () => h(PdfText, () => 'x'), { language: ['en'] }, '<PdfDocument> requires a string "language" value. Got an array.'],
    ['a PDF version the engine does not write', () => h(PdfText, () => 'x'), { pdfVersion: '9.9' }, '<PdfDocument> requires "pdfVersion" to be "1.3", "1.4", "1.5", "1.6", "1.7" or "1.7ext3". Got "9.9".'],
    ['an unknown page layout', () => h(PdfText, () => 'x'), { pageLayout: 'twoColumn' }, '<PdfDocument> requires "pageLayout" to be "singlePage", "oneColumn", "twoColumnLeft", "twoColumnRight", "twoPageLeft" or "twoPageRight". Got "twoColumn".'],
    ['widows of 0', () => h(PdfText, { widows: 0 }, () => 'x'), {}, '<PdfText> widows must be a positive whole number. Got 0.'],
  ])('rejects %s', async (_label, children, documentProps, message) => {
    await expect(mountPdfComponent(documentWith(children, documentProps))).rejects.toMatchObject({ code: 'PDF_TREE_INVALID', message })
  })

  it('rejects an unknown page orientation', async () => {
    const Fixture = defineComponent(() => () => h(PdfDocument, null, {
      default: () => h(PdfPage, { orientation: 'sideways' }, { default: () => h(PdfText, () => 'x') }),
    }))
    await expect(mountPdfComponent(Fixture)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: '<PdfPage> requires "orientation" to be "portrait" or "landscape". Got "sideways".',
    })
  })

  // The sign rule must not reject what may be negative.
  it('mounts negative margins, insets, letter spacing and transforms, and an opacity of 0 or 1', async () => {
    const mounted = await mountPdfComponent(documentWith(() => [
      h(PdfView, { style: { marginTop: -4, margin: '-2pt 0', top: -3, left: '-10%', position: 'relative', opacity: 0 } }),
      h(PdfText, { style: { letterSpacing: -0.5, transform: 'translate(-4, -2)', opacity: 1 } }, () => 'x'),
    ]))
    mounted.unmount()
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
      message: '<PdfRadialGradient id="duplicate"> has the id of another definition; definition ids must be unique within one <PdfSvg>.',
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

  // Catches a page token that reaches SVG text, where the engine adapter never
  // replaces it and the number would be silently missing.
  it('rejects a page token inside SVG text', async () => {
    await expect(mountSvgSubtree(() =>
      h(PdfText, { x: 0, y: 10 }, () => [h(PdfPageNumber)]),
    )).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: '<PdfPageNumber> is not supported inside <PdfSvg>.',
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
})

describe('fallthrough class on a local component', () => {
  const TwoLines = defineComponent({
    name: 'TwoLines',
    setup: () => () => [h(PdfText, null, () => 'One'), h(PdfText, null, () => 'Two')],
  })
  const template = (attrs: Record<string, unknown>) => defineComponent(() => () =>
    h(PdfDocument, null, () => h(PdfPage, null, () => h(TwoLines, attrs))))

  // Catches the class being dropped silently, or Vue's own warning text
  // reaching the author instead of what to change.
  it('names the component when a class meets several root elements', async () => {
    // A compiled class reaches the component as a `style` attribute.
    await expect(mountPdfComponent(template({ style: { fontSize: 20 } }))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'A class on <TwoLines> needs a single root element in that component, or v-bind="$attrs" on one element.',
    })
  })

  it('renders the same component without a class', async () => {
    const mounted = await mountPdfComponent(template({}))
    expect((mounted.document.children[0] as PdfElementNode).children).toHaveLength(2)
    mounted.unmount()
  })
})

describe('leaf primitives', () => {
  type Slot = () => VNodeChild
  const { PdfAttachment, PdfCheckbox, PdfFacturX, PdfPageCount, PdfPageRef, PdfSelect, PdfTextField } = PDF_COMPONENTS
  const LEAF_SOURCE = { [PDF_SOURCE_PROP]: 'leaf.vue:3:5' }
  const CHILD_SOURCE = { [PDF_SOURCE_PROP]: 'leaf.vue:4:7' }
  const page = (content: Slot) => h(PdfDocument, null, () => h(PdfPage, null, () => [h(PdfView, { id: 'target' }), content()]))
  const svg = (content: Slot) => page(() => h(PdfSvg, { viewBox: '0 0 10 10' }, content))
  const text = (content: Slot) => page(() => h(PdfText, null, content))

  const FACTUR_X_XML = '<rsm:CrossIndustryInvoice><ram:GuidelineSpecifiedDocumentContextParameter>'
    + '<ram:ID>urn:factur-x.eu:1p0:minimum</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:CrossIndustryInvoice>'

  // Each leaf in a context where it is valid, with its required props.
  const LEAVES: Record<string, (slot: Slot) => VNodeChild> = {
    PdfAttachment: slot => h(PdfDocument, null, () => [
      h(PdfAttachment, { name: 'a.xml', data: '<a/>', ...LEAF_SOURCE }, slot),
      h(PdfPage),
    ]),
    PdfFacturX: slot => h(PdfDocument, null, () => [
      h(PdfFacturX, { xml: FACTUR_X_XML, profile: 'MINIMUM', ...LEAF_SOURCE }, slot),
      h(PdfPage),
    ]),
    PdfImage: slot => page(() => h(PdfImage, { src: 'data:image/png;base64,', ...LEAF_SOURCE }, slot)),
    PdfTextField: slot => page(() => h(PdfTextField, { name: 'a', style: { width: 9, height: 9 }, ...LEAF_SOURCE }, slot)),
    PdfCheckbox: slot => page(() => h(PdfCheckbox, { name: 'b', style: { width: 9, height: 9 }, ...LEAF_SOURCE }, slot)),
    PdfSelect: slot => page(() => h(PdfSelect, { name: 'c', options: ['x'], style: { width: 9, height: 9 }, ...LEAF_SOURCE }, slot)),
    PdfPath: slot => svg(() => h(PdfPath, { d: 'M0 0', ...LEAF_SOURCE }, slot)),
    PdfRect: slot => svg(() => h(PdfRect, { width: 1, height: 1, ...LEAF_SOURCE }, slot)),
    PdfCircle: slot => svg(() => h(PdfCircle, { r: 1, ...LEAF_SOURCE }, slot)),
    PdfEllipse: slot => svg(() => h(PdfEllipse, { rx: 1, ry: 1, ...LEAF_SOURCE }, slot)),
    PdfLine: slot => svg(() => h(PdfLine, { x1: 0, x2: 1, y1: 0, y2: 1, ...LEAF_SOURCE }, slot)),
    PdfPolyline: slot => svg(() => h(PdfPolyline, { points: '0,0 1,1', ...LEAF_SOURCE }, slot)),
    PdfPolygon: slot => svg(() => h(PdfPolygon, { points: '0,0 1,1 1,0', ...LEAF_SOURCE }, slot)),
    PdfStop: slot => svg(() => h(PdfDefs, null, () => h(PdfLinearGradient, { id: 'g' }, () =>
      h(PdfStop, { offset: 0, stopColor: 'red', ...LEAF_SOURCE }, slot)))),
    PdfPageNumber: slot => text(() => h(PdfPageNumber, LEAF_SOURCE, slot)),
    PdfPageCount: slot => text(() => h(PdfPageCount, LEAF_SOURCE, slot)),
    PdfPageRef: slot => text(() => h(PdfPageRef, { to: 'target', ...LEAF_SOURCE }, slot)),
  }
  const mountLeaf = (name: string, slot: Slot) =>
    mountPdfComponent(defineComponent(() => () => LEAVES[name]!(slot)))
  const isLeaf = (name: PdfPrimitiveName) => {
    const spec = PDF_PRIMITIVE_TABLE[name]
    return spec.children.length === 0 && !('text' in spec)
  }
  const names = Object.keys(LEAVES)

  // Catches: a new leaf primitive in the table that this test does not cover.
  it('covers every primitive that holds no content', () => {
    expect(names).toEqual(PDF_PRIMITIVE_COMPONENT_NAMES.filter(isLeaf))
  })

  // Catches: a leaf that drops its content silently (all of them but
  // PdfAttachment did), and an error without the component or its position.
  it.each(names)('rejects text and elements in <%s> with its name and position', async (name) => {
    await expect(mountLeaf(name, () => 'caption')).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: `<${name}> cannot contain text.`,
      source: { file: 'leaf.vue', line: 3, column: 5 },
    })
    await expect(mountLeaf(name, () => h(PdfView, CHILD_SOURCE))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: `Invalid PDF nesting: <${name}> cannot contain <PdfView>.`,
      source: { file: 'leaf.vue', line: 4, column: 7 },
    })
  })

  // Catches: a check that counts whitespace or a v-if comment as content.
  it.each(names)('accepts whitespace and comments in <%s>', async (name) => {
    const mounted = await mountLeaf(name, () => [' \n ', h(Comment, 'v-if')])
    mounted.unmount()
  })
})
