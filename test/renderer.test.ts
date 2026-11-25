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
  shallowRef,
  vShow,
  watchEffect,
  withDirectives,
  type Component,
  type PropType,
  type VNodeChild,
} from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import type { PdfStyle } from '../src/runtime/authoring'
import {
  PDF_PRIMITIVE_COMPONENT_NAMES,
  PDF_PRIMITIVE_TABLE,
  PDF_PRIMITIVES,
  type PdfPrimitiveName,
} from '../src/runtime/primitives'
import { camelCase, kebabCase } from '../src/runtime/shared/case'
import { PDF_SOURCE_PROP } from '../src/runtime/shared/template'
import type {
  PdfElementNode,
  PdfTextInstance,
} from '../src/runtime/renderer/types'
import { renderPdfTemplate } from '../src/test'

const { PdfCircle, PdfClipPath, PdfDefs, PdfDocument, PdfEllipse, PdfG, PdfImage, PdfLine, PdfLinearGradient, PdfLink, PdfNote, PdfPage, PdfPath, PdfPolygon, PdfPolyline, PdfRect, PdfPageNumber, PdfStop, PdfSvg, PdfText, PdfView } = PDF_COMPONENTS

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
                wrap: props.showDynamic ? false : undefined,
              }, () => 'Stays on one page'),
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
    expect(dynamic.props.wrap).toBe(false)

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
    expect(updatedDynamic.props).not.toHaveProperty('wrap')

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

  // Catches a hint whose suggested markup does not render (the hint itself
  // is a row of "tree validation messages").
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

  // Prop and style names: every word converts, and only a letter after a
  // hyphen starts one (`data-1` is no word boundary).
  it.each([
    ['border-top-left-radius', 'borderTopLeftRadius'],
    ['data-1', 'data-1'],
  ])('converts %s and %s into each other', (kebab, camel) => {
    expect(camelCase(kebab)).toBe(camel)
    expect(kebabCase(camel)).toBe(kebab)
  })

  // PDF and SVG primitives share one normalizer; the rect covers SVG names.
  it('normalizes ordinary kebab-case PDF props before mounting', async () => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, { 'page-layout': 'singlePage' }, {
        default: () => h(PdfPage, null, {
          // A bare boolean attribute in a template (`<PdfView fixed>`) arrives as ''.
          default: () => [
            h(PdfView as Component, { 'min-presence-ahead': 48, 'fixed': '' }, {
              default: () => h(PdfNote, null, () => 'Reviewer note'),
            }),
            h(PdfSvg, { viewBox: '0 0 100 100' }, () => h(PdfRect, {
              'width': 10,
              'height': 10,
              'stroke-width': 2,
              'fill-opacity': '0.5',
              'stroke-linecap': 'round',
            })),
          ],
        }),
      }),
    )

    const mounted = await mountPdfComponent(Fixture)
    const view = elementChild(elementChild(mounted.document, 0), 0)
    const note = elementChild(view, 0)
    const rect = elementChild(elementChild(elementChild(mounted.document, 0), 1), 0)

    expect(mounted.document.props.pageLayout).toBe('singlePage')
    expect(mounted.document.props).not.toHaveProperty('page-layout')
    expect(view.props.minPresenceAhead).toBe(48)
    expect(view.props).not.toHaveProperty('min-presence-ahead')
    expect(view.props.fixed).toBe(true)
    expect(note.type).toBe(PDF_PRIMITIVES.Note)
    expect(textChild(note).value).toBe('Reviewer note')
    expect(rect.props).toEqual({
      width: 10,
      height: 10,
      strokeWidth: 2,
      fillOpacity: '0.5',
      strokeLinecap: 'round',
    })

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
})

// V1 to V7 (D23): every message names
// the element, its id when it has one, the prop or style key and the wrong
// value, so the author finds the element without a source position; values
// that rendered silently before now fail.
describe('tree validation messages', () => {
  // The fixtures pass wrong values on purpose, which the typed props reject,
  // so the components are used as plain Vue components here.
  const PLAIN: Readonly<Record<keyof typeof PDF_COMPONENTS, Component>> = PDF_COMPONENTS
  const { PdfDefs, PdfDocument, PdfImage, PdfLinearGradient, PdfLink, PdfPage, PdfPageNumber, PdfRect, PdfStop, PdfSvg, PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfText, PdfTspan, PdfView } = PLAIN
  const svgWith = (...children: VNodeChild[]) => h(PdfSvg, { width: 20, height: 20, viewBox: '0 0 20 20' }, () => children)
  const documentWith = (children: () => VNodeChild, documentProps: Record<string, unknown> = {}) =>
    defineComponent(() => () => h(PdfDocument, documentProps, {
      default: () => h(PdfPage, null, { default: children }),
    }))
  const circular: Record<string, unknown> = { color: 'red' }
  circular.self = circular

  it.each([
    ['an unknown style key', () => h(PdfText, { id: 'intro', style: { colour: 'red' } }, () => 'x'), {}, 'Unsupported PDF style "colour" on <PdfText id="intro">.'],
    ['a style value in a wrong unit', () => h(PdfView, { style: { marginTop: '3furlong' } }), {}, '<PdfView> :style value "3furlong" for "marginTop" is invalid: expected a number of points, a length such as 12pt, a percentage or auto.'],
    ['a negative font size', () => h(PdfText, { style: { fontSize: -4 } }, () => 'x'), {}, '<PdfText> :style value -4 for "fontSize" is invalid: expected a value above 0.'],
    // The text layout read 0 as unset: the text printed at 12 pt, the lines at the normal height.
    ['a font size of 0', () => h(PdfText, { style: { fontSize: 0 } }, () => 'x'), {}, '<PdfText> :style value 0 for "fontSize" is invalid: expected a value above 0.'],
    ['a line height of 0%', () => h(PdfText, { style: { lineHeight: '0%' } }, () => 'x'), {}, '<PdfText> :style value "0%" for "lineHeight" is invalid: expected a value above 0.'],
    ['a negative part of a padding shorthand', () => h(PdfView, { style: { padding: '4pt -2pt' } }), {}, '<PdfView> :style value "4pt -2pt" for "padding" is invalid: expected a value of 0 or more.'],
    ['an opacity above 1', () => h(PdfView, { style: [{ opacity: 0.5 }, { opacity: 1.5 }] }), {}, '<PdfView> :style value 1.5 for "opacity" is invalid: expected a number from 0 to 1.'],
    ['an alignSelf the engine does not know', () => h(PdfView, { style: { alignSelf: 'middle' } }), {}, '<PdfView> :style value "middle" for "alignSelf" is invalid: expected one of auto, flex-start, flex-end, center, stretch, baseline.'],
    ['a negative rowGap', () => h(PdfView, { style: { rowGap: -2 } }), {}, '<PdfView> :style value -2 for "rowGap" is invalid: expected a value of 0 or more.'],
    // In a column, a percentage gap would be a share of a height the column does not have.
    ['a percentage rowGap', () => h(PdfView, { style: { rowGap: '5%' } }), {}, '<PdfView> :style value "5%" for "rowGap" is invalid: expected a number of points or a length such as 12pt or 4mm.'],
    ['an alignContent the engine does not know', () => h(PdfView, { style: { alignContent: 'space' } }), {}, '<PdfView> :style value "space" for "alignContent" is invalid: expected one of flex-start, flex-end, center, stretch, space-between, space-around, space-evenly.'],
    // The layout places baseline as flex-start, so it is not accepted.
    ['alignContent baseline', () => h(PdfView, { style: { alignContent: 'baseline' } }), {}, '<PdfView> :style value "baseline" for "alignContent" is invalid: expected one of flex-start, flex-end, center, stretch, space-between, space-around, space-evenly.'],
    // em: not on a key that a percentage covers (fontSize) or whose readers
    // need points before inheritance (height); a negative em padding fails.
    ['an em height', () => h(PdfView, { style: { height: '2em' } }), {}, '<PdfView> :style value "2em" for "height" is invalid: expected a number of points, a length such as 12pt, or a percentage.'],
    ['an em fontSize', () => h(PdfText, { style: { fontSize: '1.2em' } }, () => 'x'), {}, '<PdfText> :style value "1.2em" for "fontSize" is invalid: expected a number of points, a length such as 12pt, or a percentage.'],
    ['a negative em padding', () => h(PdfView, { style: { padding: '0 -1em' } }), {}, '<PdfView> :style value "0 -1em" for "padding" is invalid: expected a value of 0 or more.'],
    ['a gap of three values', () => h(PdfView, { style: { gap: '4 8 2' } }), {}, '<PdfView> :style value "4 8 2" for "gap" is invalid: expected one or two values, each a number of points or a length such as 12pt or 4mm.'],
    ['an objectPosition with an edge offset', () => h(PdfView, { style: { objectPosition: 'right 10pt bottom 4pt' } }), {}, '<PdfView> :style value "right 10pt bottom 4pt" for "objectPosition" is invalid: expected one or two parts, each a length, a percentage, or left, center, right, top or bottom, such as right 10pt.'],
    ['textTransform upperfirst', () => h(PdfText, { style: { textTransform: 'upperfirst' } }, () => 'x'), {}, '<PdfText> :style value "upperfirst" for "textTransform" is invalid: expected one of none, capitalize, lowercase, uppercase. "upperfirst" is not CSS; "capitalize" sets the first letter of every word in upper case, so to raise only the first letter of the text, write it in upper case.'],
    // A DOM directive mutates a style the primitive does not declare.
    ['v-show', () => withDirectives(h(PdfText, null, () => 'Hidden content'), [[vShow, false]]), {}, 'Unsupported PDF style "display" on <PdfText>.'],
    ['an empty id', () => h(PdfText, { id: ' ' }, () => 'x'), {}, '<PdfText> "id" must be a non-empty string. Got " ".'],
    ['an id that is not a string', () => h(PdfView, { id: 42 }), {}, '<PdfView> "id" must be a non-empty string. Got 42.'],
    ['a reserved id', () => h(PdfText, { id: '__proto__' }, () => 'x'), {}, '<PdfText id="__proto__"> uses a reserved identifier as its id; use another id.'],
    ['the reserved id constructor', () => h(PdfText, { id: 'constructor' }, () => 'x'), {}, '<PdfText id="constructor"> uses a reserved identifier as its id; use another id.'],
    ['the reserved id prototype', () => h(PdfText, { id: 'prototype' }, () => 'x'), {}, '<PdfText id="prototype"> uses a reserved identifier as its id; use another id.'],
    ['a duplicate id', () => [h(PdfView, { id: 'intro' }), h(PdfText, { id: 'intro' }, () => 'x')], {}, '<PdfView id="intro"> and <PdfText id="intro"> have the same id; ids must be unique within a document.'],
    // In production there is no source position: the message names the link and the id.
    ['a missing internal destination', () => [h(PdfLink, { href: '#intro' }, () => 'Works'), h(PdfLink, { id: 'toc-link', href: `#${'m'.repeat(50)}` }, () => 'Broken'), h(PdfView, { id: 'intro' })], {}, `<PdfLink id="toc-link"> internal destination does not match any id in the document: href "#${'m'.repeat(36)}...". Give the target element id="${'m'.repeat(37)}..." or correct "href".`],
    ['an empty internal destination', () => h(PdfLink, { href: '#' }, () => 'Empty'), {}, '<PdfLink> internal destinations must name a non-empty id.'],
    ['a javascript: link', () => h(PdfLink, { href: 'javascript:alert(1)' }, () => 'x'), {}, '<PdfLink> "href" "javascript:alert(1)" is not a link a PDF may open. Use an absolute URL with http:, https:, mailto: or tel:, or "#id" for an element of the document.'],
    ['a file: link', () => h(PdfLink, { href: 'file:///etc/passwd' }, () => 'x'), {}, '<PdfLink> "href" "file:///etc/passwd" is not a link a PDF may open. Use an absolute URL with http:, https:, mailto: or tel:, or "#id" for an element of the document.'],
    ['a data: link', () => h(PdfLink, { href: 'data:text/html,x' }, () => 'x'), {}, '<PdfLink> "href" "data:text/html,x" is not a link a PDF may open. Use an absolute URL with http:, https:, mailto: or tel:, or "#id" for an element of the document.'],
    ['a vbscript: link', () => h(PdfLink, { href: 'vbscript:x' }, () => 'x'), {}, '<PdfLink> "href" "vbscript:x" is not a link a PDF may open. Use an absolute URL with http:, https:, mailto: or tel:, or "#id" for an element of the document.'],
    ['a custom scheme link', () => h(PdfLink, { href: 'myapp://open' }, () => 'x'), {}, '<PdfLink> "href" "myapp://open" is not a link a PDF may open. Use an absolute URL with http:, https:, mailto: or tel:, or "#id" for an element of the document.'],
    ['a relative link', () => h(PdfLink, { href: 'docs/terms' }, () => 'x'), {}, '<PdfLink> "href" "docs/terms" is not a link a PDF may open. Use an absolute URL with http:, https:, mailto: or tel:, or "#id" for an element of the document.'],
    ['a Vue event prop', () => h(PdfText, { onClick: () => undefined }, () => 'x'), {}, 'Vue event prop "onClick" is not supported on <PdfText>: a PDF has no events.'],
    ['the DOM-only attribute aria-label', () => h(PdfText, { 'aria-label': 'web-only' }, () => 'x'), {}, 'DOM-only attribute "aria-label" is not supported on <PdfText>. Use PDF props and styles instead.'],
    ['the DOM-only attribute data-testid', () => h(PdfText, { 'data-testid': 'web-only' }, () => 'x'), {}, 'DOM-only attribute "data-testid" is not supported on <PdfText>. Use PDF props and styles instead.'],
    ['the DOM-only attribute role', () => h(PdfText, { role: 'web-only' }, () => 'x'), {}, 'DOM-only attribute "role" is not supported on <PdfText>. Use PDF props and styles instead.'],
    // A class that bypasses the SFC compiler (render function, v-bind object)
    // must fail and point to the <style> block, not vanish.
    ['a class that did not come from a compiled template', () => h(PdfText, { class: 'title' }, () => 'x'), {}, 'Unsupported "class" on <PdfText>. Classes come from the <style> block of a PDF component and only work through class or :class in its template; pass a style object otherwise.'],
    // A non-cloneable value would fail later, in postMessage, without naming its place.
    ['a function inside a style', () => h(PdfView, { style: { color: () => 'red' } }), {}, 'The "style" prop on <PdfView> must be plain data: it contains a function.'],
    ['a class instance in a prop', () => h(PdfView, { bookmark: new (class Bookmark { title = 'x' })() }), {}, 'The "bookmark" prop on <PdfView> must be plain data: it contains a class instance.'],
    ['a circular object in a prop', () => h(PdfView, { style: circular }), {}, 'The "style" prop on <PdfView> must be plain data: it contains a circular reference.'],
    ['an image without a source', () => h(PdfImage, {}), {}, '<PdfImage> requires a "src" prop.'],
    ['an image with the removed source alias', () => h(PdfImage, { source: new Uint8Array([1]) }), {}, 'Unsupported prop "source" on <PdfImage>.'],
    ['a link without a target', () => h(PdfLink, {}, () => 'invalid link'), {}, '<PdfLink> requires an "href" prop.'],
    ['a link with the removed src alias', () => h(PdfLink, { src: '#missing' }, () => 'invalid link'), {}, 'Unsupported prop "src" on <PdfLink>.'],
    ['a long wrong value, cut at 40 characters', () => h(PdfText, { tag: 'h'.repeat(60) }, () => 'x'), {}, `<PdfText> requires "tag" to be "h1", "h2", "h3", "h4", "h5", "h6" or "p". Got "${'h'.repeat(37)}...".`],
    ['a bookmark that is a number', () => h(PdfText, { bookmark: 42 }, () => 'x'), {}, '<PdfText> requires "bookmark" to be a title string or { title: string, expanded?: boolean, contents?: false }. Got 42.'],
    ['a bookmark with an unknown key', () => h(PdfView, { bookmark: { title: 'Part', open: true } }), {}, '<PdfView> requires "bookmark" to be a title string or { title: string, expanded?: boolean, contents?: false }. Got an object.'],
    ['a title that is not a string', () => h(PdfText, () => 'x'), { title: 42 }, '<PdfDocument> requires a string "title" value. Got 42.'],
    ['a language that is not a string', () => h(PdfText, () => 'x'), { language: ['en'] }, '<PdfDocument> requires a string "language" value. Got an array.'],
    ['a PDF version the engine does not write', () => h(PdfText, () => 'x'), { pdfVersion: '9.9' }, '<PdfDocument> requires "pdfVersion" to be "1.3", "1.4", "1.5", "1.6", "1.7" or "1.7ext3". Got "9.9".'],
    ['an unknown page layout', () => h(PdfText, () => 'x'), { pageLayout: 'twoColumn' }, '<PdfDocument> requires "pageLayout" to be "singlePage", "oneColumn", "twoColumnLeft", "twoColumnRight", "twoPageLeft" or "twoPageRight". Got "twoColumn".'],
    ['widows of 0', () => h(PdfText, { widows: 0 }, () => 'x'), {}, '<PdfText> widows must be a positive whole number. Got 0.'],
    // The text does not appear in the message: it may be customer data.
    ['text in a view', () => h(PdfView, { id: 'orphan' }, () => 'private customer text'), {}, '<PdfView> cannot contain text. Wrap it in <PdfText>.'],
    // The later invalid prop also catches a nesting check deferred past mount:
    // the first defect in mount order must stay the reported one.
    ['a page in a view, before a later defect', () => [h(PdfView, null, () => [h(PdfPage, { key: 'invalid-page' }), h(PdfText, { key: 'valid-text' }, () => 'Still valid')]), h(PdfImage, { src: 'logo.png', title: 'later defect' })], {}, 'Invalid PDF nesting: <PdfView> cannot contain <PdfPage>.'],
    // A plain TypeError would reach the user as an uncategorized PDF_RENDER_ERROR.
    ['an unknown primitive from a render function', () => h('FOO'), {}, 'Unknown PDF primitive "FOO".'],
    ['an Svg inside a PdfText', () => h(PdfText, null, () => h(PdfSvg, { viewBox: '0 0 1 1' })), {}, 'Invalid PDF nesting: <PdfText> cannot contain <PdfSvg>.'],
    ['a Tspan in page-flow text', () => h(PdfText, null, () => h(PdfTspan, null, () => 'not SVG text')), {}, '<PdfTspan> is only supported inside SVG text.'],
    ['SVG text paint on page-flow text', () => h(PdfText, { fill: '#f00' }, () => 'text'), {}, '<PdfText> takes "fill", "x" and "y" only inside <PdfSvg>.'],
    // Migration hints must lead to valid markup: the next error is not the
    // hint's fault (a token in a link inside a text), no hint is missing (a
    // token in a view), and a render callback that hid content on some pages
    // learns about `pages`.
    ['the removed render prop', () => h(PdfText, { fixed: true, render: () => 'Page 1' }), {}, 'Unsupported prop "render" on <PdfText>. Use <PdfPageNumber /> and <PdfPageCount /> inside the text. Use pages="first" or pages="continuation" on a fixed text to show it on some pages only.'],
    ['a page token in a link inside a text', () => h(PdfText, { fixed: true }, () => [h(PdfLink, { href: 'https://example.com/' }, () => h(PdfPageNumber)), ' Head']), {}, 'Invalid PDF nesting: <PdfLink> cannot contain <PdfPageNumber>. Wrap it in <PdfText>. Keep that <PdfLink> outside any other text: <PdfLink><PdfText>… <PdfPageNumber /></PdfText></PdfLink>.'],
    ['a page token directly in a view', () => h(PdfView, { fixed: true }, () => h(PdfPageNumber)), {}, 'Invalid PDF nesting: <PdfView> cannot contain <PdfPageNumber>. Put it inside a <PdfText>.'],
    // The hint's own list of tokens left out the running value.
    ['a running value directly in a view', () => h(PdfView, { fixed: true }, () => h(PDF_COMPONENTS.PdfRunningText, { name: 'chapter' })), {}, 'Invalid PDF nesting: <PdfView> cannot contain <PdfRunningText>. Put it inside a <PdfText>.'],
    // The engine reads operation names as written: `Translate` drew nothing moved.
    ['an SVG transform in another case', () => svgWith(h(PdfRect, { width: 4, height: 4, transform: 'Translate(2)' })), {}, '<PdfRect> has an unsupported SVG transform. Got "Translate(2)".'],
    // V2: the engine ignores a negative flex part, drops every line at a
    // maxLines of 0, and paints other SVG colors black or a wrong color.
    ['a negative flex', () => h(PdfView, { style: { flex: -1 } }), {}, '<PdfView> :style value -1 for "flex" is invalid: expected a value of 0 or more.'],
    ['a negative shrink in flex', () => h(PdfView, { style: { flex: '1 -1 0' } }), {}, '<PdfView> :style value "1 -1 0" for "flex" is invalid: expected a value of 0 or more.'],
    ['a maxLines of 0', () => h(PdfText, { style: { maxLines: 0 } }, () => 'x'), {}, '<PdfText> :style value 0 for "maxLines" is invalid: expected a whole number of 1 or more.'],
    // A shift is relative to the lines of a text around it; an outer text has none.
    ['a superscript on an outer text', () => h(PdfText, { style: [{ verticalAlign: 'baseline' }, { verticalAlign: 'super' }] }, () => 'x'), {}, 'verticalAlign "super" on <PdfText> needs a <PdfText> or <PdfLink> inside another <PdfText>: it raises or lowers them within the lines of that text. Wrap the characters in a nested <PdfText>.'],
    // A percentage font size is a share of the inherited one; SVG text
    // resolves its own inheritance and would take it as no size.
    ['a percentage font size on SVG text', () => svgWith(h(PdfText, { x: 0, y: 10, style: { fontSize: '70%' } }, () => 'x')), {}, 'fontSize "70%" on SVG <PdfText> is a percentage, which SVG text does not take. Give it a length, such as 10.'],
    ['a fractional maxLines', () => h(PdfText, { style: { maxLines: 1.5 } }, () => 'x'), {}, '<PdfText> :style value 1.5 for "maxLines" is invalid: expected a whole number of 1 or more.'],
    ['a hitSlop with a negative side', () => h(PdfLink, { href: 'https://example.com', hitSlop: { top: -2 } }, () => 'x'), {}, '<PdfLink> requires "hitSlop" to be an object with "top", "right", "bottom" or "left" set to numbers of 0 or more. Got an object.'],
    ['a hitSlop with an unknown side', () => h(PdfLink, { href: 'https://example.com', hitSlop: { up: 2 } }, () => 'x'), {}, '<PdfLink> requires "hitSlop" to be an object with "top", "right", "bottom" or "left" set to numbers of 0 or more. Got an object.'],
    ['a fill of an unknown name', () => svgWith(h(PdfRect, { width: 10, height: 10, fill: 'bleu' })), {}, '<PdfRect> requires "fill" to be a hex color (#rgb, #rgba, #rrggbb or #rrggbbaa), rgb(), hsl(), hwb(), a color name or transparent, or "none". Got "bleu".'],
    ['a stroke of currentColor', () => svgWith(h(PdfRect, { width: 10, height: 10, stroke: 'currentColor' })), {}, '<PdfRect> requires "stroke" to be a hex color (#rgb, #rgba, #rrggbb or #rrggbbaa), rgb(), hsl(), hwb(), a color name or transparent, or "none". Got "currentColor".'],
    ['a stop color of none', () => svgWith(h(PdfDefs, null, () => h(PdfLinearGradient, { id: 'g' }, () => h(PdfStop, { offset: 0, stopColor: 'none' })))), {}, '<PdfStop> requires "stopColor" to be a hex color (#rgb, #rgba, #rrggbb or #rrggbbaa), rgb(), hsl(), hwb(), a color name or transparent. Got "none".'],
    ['an SVG text fill of currentColor', () => svgWith(h(PdfText, { x: 0, y: 10, fill: 'currentColor' }, () => 'x')), {}, '<PdfText> requires "fill" to be a hex color (#rgb, #rgba, #rrggbb or #rrggbbaa), rgb(), hsl(), hwb(), a color name or transparent. Got "currentColor".'],
    // E4: the layout cannot honour a break in these places (D26).
    ['a break inside a row', () => h(PdfView, { id: 'totals', style: { flexDirection: 'row' } }, () => h(PdfView, null, () => h(PdfText, { break: true }, () => 'x'))), {}, '<PdfText> cannot have "break" inside <PdfView id="totals">, whose flexDirection is "row": its children sit side by side, so a break cannot end the page for one of them. Put "break" on <PdfView id="totals"> instead.'],
    ['a break inside a row-reverse set by a later style', () => h(PdfView, { style: [{ flexDirection: 'column' }, { flexDirection: 'row-reverse' }] }, () => h(PdfView, { break: true })), {}, '<PdfView> cannot have "break" inside <PdfView>, whose flexDirection is "row-reverse": its children sit side by side, so a break cannot end the page for one of them. Put "break" on <PdfView> instead.'],
    ['a break inside a table cell', () => h(PdfTable, { columns: [1, 1] }, () => h(PdfTableRow, { id: 'row-2' }, () => [h(PdfTableCell, () => 'a'), h(PdfTableCell, () => h(PdfText, { break: true }, () => 'b'))])), {}, '<PdfText> cannot have "break" inside <PdfTableRow id="row-2">: the cells of a table row move to the next page together. Put "break" on <PdfTableRow id="row-2"> instead.'],
    ['a break inside a table header', () => h(PdfTable, { columns: [1] }, () => h(PdfTableHeader, () => h(PdfTableCell, () => h(PdfText, { break: true }, () => 'a')))), {}, '<PdfText> cannot have "break" inside <PdfTableHeader>, a fixed node that repeats on every page. Remove "break".'],
    ['a break inside a fixed node', () => h(PdfView, { fixed: true }, () => h(PdfText, { id: 'running', break: true }, () => 'x')), {}, '<PdfText id="running"> cannot have "break" inside <PdfView>, a fixed node that repeats on every page. Remove "break".'],
    ['a break inside a wrap={false} node', () => h(PdfView, { wrap: false, style: { flexDirection: 'row' } }, () => h(PdfText, { break: true }, () => 'x')), {}, '<PdfText> cannot have "break" inside <PdfView>, which has wrap={false} and stays whole on one page. Remove wrap={false} or remove "break".'],
  ])('rejects %s', async (_label, children, documentProps, message) => {
    await expect(mountPdfComponent(documentWith(children, documentProps))).rejects.toMatchObject({ code: 'PDF_TREE_INVALID', message })
  })

  it.each([
    ['a document with no PdfPage', () => h(PdfDocument), '<PdfDocument> requires at least one <PdfPage>.'],
    ['two documents at the root', () => h(Fragment, null, [h(PdfDocument, { key: 'first' }), h(PdfDocument, { key: 'second' })]), 'A PDF component must render exactly one PdfDocument at its root.'],
    ['a valid prop on the wrong primitive', () => h(PdfDocument, null, () => h(PdfPage, { title: 'wrong host' })), 'Unsupported prop "title" on <PdfPage>.'],
    ['an unknown page orientation', () => h(PdfDocument, null, () => h(PdfPage, { orientation: 'sideways' }, () => h(PdfText, () => 'x'))), '<PdfPage> requires "orientation" to be "portrait" or "landscape". Got "sideways".'],
    // A page inherits no font size, and its own is the rem base.
    ['a percentage font size on a page', () => h(PdfDocument, null, () => h(PdfPage, { style: { fontSize: '80%' } }, () => h(PdfText, () => 'x'))), 'fontSize "80%" on <PdfPage> is a percentage, but a page inherits no font size to take it of. Give the page a length, such as 10, or set the percentage on the content.'],
    // A page puts what passes its end on the next page: a second column would lose lines.
    ['a page with flexWrap', () => h(PdfDocument, null, () => h(PdfPage, { style: { flexWrap: 'wrap' } }, () => h(PdfText, () => 'x'))), 'flexWrap "wrap" on <PdfPage> is not supported: a page puts the content that passes its end on the next page, not in another column. Remove flexWrap, or give the content a <PdfView> with columnCount for text in columns, or a <PdfView> with flexDirection "row" and flexWrap for a grid.'],
    ['a page of zero dpi', () => h(PdfDocument, null, () => h(PdfPage, { dpi: 0 })), '<PdfPage> dpi must be a positive finite number. Got 0.'],
    ['a page size with a negative width', () => h(PdfDocument, null, () => h(PdfPage, { size: [-1, 100] })), '<PdfPage> size must be a known page name or positive width and height. Got width -1.'],
    ['a page size with a zero height', () => h(PdfDocument, null, () => h(PdfPage, { size: { width: 100, height: '0pt' } })), '<PdfPage> size must be a known page name or positive width and height. Got height "0pt".'],
    ['a page size of three values', () => h(PdfDocument, null, () => h(PdfPage, { size: [100, 100, 100] })), '<PdfPage> size must be a known page name or positive width and height. Got an array of 3 values.'],
    ['an unknown page size name', () => h(PdfDocument, null, () => h(PdfPage, { size: 'invoice' })), '<PdfPage> size must be a known page name or positive width and height. Got "invoice".'],
    ['a page wrap given as a string', () => h(PdfDocument, null, () => h(PdfPage, { wrap: 'false' })), '<PdfPage> requires a boolean "wrap" value. Got "false".'],
    ['a break on a child of a row page', () => h(PdfDocument, null, () => h(PdfPage, { style: { flexDirection: 'row' } }, () => [h(PdfText, () => 'a'), h(PdfText, { break: true }, () => 'b')])), '<PdfText> cannot have "break" inside <PdfPage>, whose flexDirection is "row": its children sit side by side, so a break cannot end the page for one of them. Remove "break".'],
  ])('rejects %s', async (_label, root, message) => {
    await expect(mountPdfComponent(defineComponent(() => root))).rejects.toMatchObject({ code: 'PDF_TREE_INVALID', message })
  })

  // The row itself, a table row, a wrap={false} node and a fixed node keep
  // their own break; so does a node in a column inside a plain view.
  it('mounts a break on a row, a table row, a wrap={false} node and inside column views', async () => {
    const mounted = await mountPdfComponent(documentWith(() => [
      h(PdfView, { break: true, style: { flexDirection: 'row' } }, () => h(PdfText, () => 'a')),
      h(PdfTable, { columns: [1] }, () => [h(PdfTableRow, () => h(PdfTableCell, () => 'b')), h(PdfTableRow, { break: true }, () => h(PdfTableCell, () => 'c'))]),
      h(PdfView, { break: true, wrap: false }, () => h(PdfText, () => 'd')),
      h(PdfView, null, () => h(PdfView, { style: { flexDirection: 'column' } }, () => h(PdfText, { break: true }, () => 'e'))),
    ]))
    mounted.unmount()
  })

  it('mounts the flex keywords, a whole maxLines, a hitSlop and the SVG colors the engine reads', async () => {
    const mounted = await mountPdfComponent(documentWith(() => [
      ...['auto', 'none', 'initial', 2, '1 1 30pt'].map(flex => h(PdfView, { style: { flex } })),
      h(PdfText, { style: { maxLines: 3 } }, () => 'x'),
      h(PdfLink, { href: 'https://example.com', hitSlop: { top: 2, left: 0 } }, () => 'x'),
      svgWith(
        h(PdfDefs, null, () => h(PdfLinearGradient, { id: 'g' }, () => h(PdfStop, { offset: 0, stopColor: 'hsl(0, 100%, 50%)' }))),
        ...['#f00', '#FF0000', 'red', ' red ', 'rgb(255, 0, 0)', 'none', 'url(#g)'].map(fill => h(PdfRect, { width: 10, height: 10, fill, stroke: 'none' })),
        h(PdfText, { x: 0, y: 10, fill: 'purple' }, () => 'x'),
      ),
    ]))
    mounted.unmount()
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

/** Each text run as "text left top", from the page's top left, in a 200 pt wide page of Helvetica 10 without padding. */
const runsOf = async (children: () => VNodeChild, pageStyle: PdfStyle = {}) => {
  const { parsed } = await renderPdfTemplate(defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { size: [200, 100], style: { fontFamily: 'Helvetica', fontSize: 10, ...pageStyle } }, children))), {})
  const page = parsed.pages[0]!
  return page.textRuns.map(run => `${run.text} ${Math.round(run.x * 100) / 100} ${Math.round((page.height - run.y) * 100) / 100}`)
}

describe('flex keys the engine reads', () => {
  // Catches alignSelf that is dropped (the text stays at the left), or that
  // does not give way to the parent's alignItems with 'auto'.
  it.each<[string, PdfStyle, PdfStyle, string]>([
    ['center', {}, { alignSelf: 'center' }, 'x 80 9'],
    ['flex-end', {}, { alignSelf: 'flex-end' }, 'x 160 9'],
    ['auto under alignItems center', { alignItems: 'center' }, { alignSelf: 'auto' }, 'x 80 9'],
    ['flex-start under alignItems center', { alignItems: 'center' }, { alignSelf: 'flex-start' }, 'x 0 9'],
  ])('places a 40 pt text with alignSelf %s', async (_name, parent, own, run) => {
    expect(await runsOf(() => h(PdfView, { style: parent }, () => h(PdfText, { style: { width: 40, ...own } }, () => 'x')))).toEqual([run])
  })

  // Catches rowGap that is dropped, or that also sets the column gap: a row
  // gap spaces the texts of a column, a column gap does not.
  it.each<[string, PdfStyle, string[]]>([
    ['rowGap: 10', { rowGap: 10 }, ['a 0 9', 'b 0 30']],
    ['columnGap: 10', { columnGap: 10 }, ['a 0 9', 'b 0 20']],
  ])('spaces the texts of a column with %s', async (_name, style, runs) => {
    expect(await runsOf(() => h(PdfView, { style }, () => [h(PdfText, () => 'a'), h(PdfText, () => 'b')]))).toEqual(runs)
  })

  // Catches alignContent that is dropped (the two lines stay at the top) or
  // mapped to the wrong yoga value: two 120 pt texts wrap into two lines of a
  // 100 pt high row.
  it.each<[NonNullable<PdfStyle['alignContent']>, string[]]>([
    ['flex-start', ['a 0 9', 'b 0 20']],
    ['flex-end', ['a 0 87', 'b 0 98']],
    ['center', ['a 0 48', 'b 0 59']],
    ['space-between', ['a 0 9', 'b 0 98']],
  ])('places the lines of a wrapping row with alignContent %s', async (alignContent, runs) => {
    const style: PdfStyle = { flexDirection: 'row', flexWrap: 'wrap', height: 100, alignContent }
    expect(await runsOf(() => h(PdfView, { style }, () => [h(PdfText, { style: { width: 120 } }, () => 'a'), h(PdfText, { style: { width: 120 } }, () => 'b')]))).toEqual(runs)
  })
})

describe('Vue PDF SVG nesting', () => {
  const PLAIN: Readonly<Record<keyof typeof PDF_COMPONENTS, Component>> = PDF_COMPONENTS
  const mountSvgSubtree = (child: () => VNodeChild, svgProps: Record<string, unknown> = { viewBox: '0 0 100 100' }) => {
    const Fixture = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PLAIN.PdfSvg, svgProps, {
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

  const { PdfCircle: Circle, PdfClipPath: ClipPath, PdfDefs: Defs, PdfEllipse: Ellipse, PdfG: G, PdfLine: Line, PdfLinearGradient: LinearGradient, PdfPageNumber: PageNumber, PdfPath: Path, PdfPolygon: Polygon, PdfPolyline: Polyline, PdfRadialGradient: RadialGradient, PdfRect: Rect, PdfStop: Stop, PdfText: Text, PdfTspan: Tspan } = PLAIN
  const inDefs = (child: () => VNodeChild) => () => h(Defs, null, child)

  it.each([
    ['a missing PdfPath.d', () => h(Path), '<PdfPath> requires the "d" prop.'],
    ['a missing PdfRect.height', () => h(Rect, { width: 1 }), '<PdfRect> requires the "height" prop.'],
    ['a missing PdfCircle.r', () => h(Circle), '<PdfCircle> requires the "r" prop.'],
    ['a missing PdfEllipse.ry', () => h(Ellipse, { rx: 1 }), '<PdfEllipse> requires the "ry" prop.'],
    ['a missing PdfLine.y2', () => h(Line, { x1: 0, x2: 1, y1: 0 }), '<PdfLine> requires the "y2" prop.'],
    ['a missing PdfPolyline.points', () => h(Polyline), '<PdfPolyline> requires the "points" prop.'],
    ['a missing PdfPolygon.points', () => h(Polygon), '<PdfPolygon> requires the "points" prop.'],
    ['a missing PdfClipPath.id', inDefs(() => h(ClipPath)), '<PdfClipPath> "id" must be a safe identifier: a letter or "_", then letters, digits, "_", "-", "." or ":". Got undefined.'],
    ['a missing PdfLinearGradient.id', inDefs(() => h(LinearGradient)), '<PdfLinearGradient> "id" must be a safe identifier: a letter or "_", then letters, digits, "_", "-", "." or ":". Got undefined.'],
    ['a missing PdfRadialGradient.id', inDefs(() => h(RadialGradient)), '<PdfRadialGradient> "id" must be a safe identifier: a letter or "_", then letters, digits, "_", "-", "." or ":". Got undefined.'],
    ['a missing PdfStop.stopColor', inDefs(() => h(LinearGradient, { id: 'g' }, () => h(Stop, { offset: 0 }))), '<PdfStop> requires the "stopColor" prop.'],
    ['a negative stroke width', () => h(Line, { strokeWidth: -1, x1: 0, x2: 1, y1: 0, y2: 1 }), '<PdfLine> requires a non-negative "strokeWidth" value. Got -1.'],
    ['a fill opacity above one', () => h(Rect, { fillOpacity: 1.1, height: 1, width: 1 }), '<PdfRect> requires "fillOpacity" between 0 and 1 (or 0% and 100%). Got 1.1.'],
    ['nonnumeric geometry', () => h(Rect, { height: 1, width: 'large' }), '<PdfRect> has an invalid "width" value. Got "large".'],
    ['an unsupported transform', () => h(Rect, { height: 1, transform: 'skewX(10)', width: 1 }), '<PdfRect> has an unsupported SVG transform. Got "skewX(10)".'],
    ['a dangling fill reference', () => h(Rect, { fill: 'url(#missing)', height: 1, width: 1 }), '<PdfRect> fill "url(#missing)" references a missing or incompatible definition.'],
    ['a gradient used as a clip path', () => [h(Defs, { key: 'defs' }, () => h(LinearGradient, { id: 'paint' })), h(Rect, { key: 'shape', clipPath: 'url(#paint)', height: 1, width: 1 })], '<PdfRect> clipPath "url(#paint)" references a missing or incompatible definition.'],
    ['duplicate definition ids', inDefs(() => [h(LinearGradient, { id: 'duplicate' }), h(RadialGradient, { id: 'duplicate' })]), '<PdfRadialGradient id="duplicate"> has the id of another definition; definition ids must be unique within one <PdfSvg>.'],
    ['two Defs children', () => [h(Defs, { key: 'first' }), h(Defs, { key: 'second' })], '<PdfSvg> accepts at most one <PdfDefs> child.'],
    ['Defs inside a G', () => h(G, null, () => [h(Rect, { key: 'kept', width: 1, height: 1 }), h(Defs, { key: 'dropped' })]), 'Invalid PDF nesting: <PdfG> cannot contain <PdfDefs>.'],
    // Upstream would draw nothing for a Tspan outside Text.
    ['a Tspan outside Text', () => h(G, null, () => [h(Text, { key: 'text', x: 0, y: 0 }, () => h(Tspan, null, () => 'kept')), h(Tspan, { key: 'orphan' }, () => 'dropped')]), 'Invalid PDF nesting: <PdfG> cannot contain <PdfTspan>.'],
    // The engine adapter never replaces a token in SVG text: the number would be missing.
    ['a page token inside SVG text', () => h(Text, { x: 0, y: 10 }, () => [h(PageNumber)]), '<PdfPageNumber> is not supported inside <PdfSvg>.'],
    ['SVG text without coordinates', () => h(Text, { fill: '#f00' }, () => 'invalid SVG text'), 'SVG <PdfText> requires both "x" and "y" props.'],
    ['SVG text with a page-flow prop', () => h(Text, { fixed: true, x: 0, y: 0 }, () => 'invalid SVG text'), 'SVG <PdfText> does not accept the page-flow text prop "fixed".'],
    ['a raw shape in Defs', inDefs(() => [h(LinearGradient, { key: 'grad', id: 'g' }), h(ClipPath, { key: 'clip', id: 'c' }), h(Rect, { key: 'raw', width: 1, height: 1 })]), 'Invalid PDF nesting: <PdfDefs> cannot contain <PdfRect>.'],
    ['text in a ClipPath', inDefs(() => h(ClipPath, { id: 'c' }, () => [h(Rect, { key: 'kept', width: 1, height: 1 }), h(Text, { key: 'dropped' }, () => 'no text in clip')])), 'Invalid PDF nesting: <PdfClipPath> cannot contain <PdfText>.'],
    ['a shape in a gradient', inDefs(() => h(LinearGradient, { id: 'g' }, () => [h(Stop, { key: 'kept', offset: '0', stopColor: '#000' }), h(Rect, { key: 'dropped', width: 1, height: 1 })])), 'Invalid PDF nesting: <PdfLinearGradient> cannot contain <PdfRect>.'],
  ])('rejects %s', async (_label, child, message) => {
    await expect(mountSvgSubtree(child)).rejects.toMatchObject({ code: 'PDF_TREE_INVALID', message })
  })

  it('rejects a malformed viewBox', async () => {
    await expect(mountSvgSubtree(() => null, { viewBox: '0 0 nope 10' })).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: '<PdfSvg> viewBox must contain four finite numbers with positive width and height. Got "0 0 nope 10".',
    })
  })

  // Catches a `value || default` that drops a present zero.
  it('treats numeric zero as present for required SVG props', async () => {
    const mounted = await mountSvgSubtree(() => [
      h(PdfRect, { height: 0, width: 0, fillOpacity: 0 }),
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
    expect(elementChild(svgOf(mounted), 0).props.fillOpacity).toBe(0)
    mounted.unmount()
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
  const { PdfAttachment, PdfCheckbox, PdfContents, PdfFacturX, PdfLeader, PdfPageCount, PdfPageRef, PdfRadio, PdfRunningText, PdfSelect, PdfTextField } = PDF_COMPONENTS
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
    PdfFacturX: slot => h(PdfDocument, { conformance: 'PDF/A-3b' }, () => [
      h(PdfFacturX, { xml: FACTUR_X_XML, profile: 'MINIMUM', ...LEAF_SOURCE }, slot),
      h(PdfPage),
    ]),
    PdfImage: slot => page(() => h(PdfImage, { src: 'data:image/png;base64,', ...LEAF_SOURCE }, slot)),
    PdfContents: slot => page(() => [h(PdfContents, LEAF_SOURCE, slot), h(PdfText, { bookmark: 'Entry' }, () => 'Entry')]),
    PdfTextField: slot => page(() => h(PdfTextField, { name: 'a', style: { width: 9, height: 9 }, ...LEAF_SOURCE }, slot)),
    PdfCheckbox: slot => page(() => h(PdfCheckbox, { name: 'b', style: { width: 9, height: 9 }, ...LEAF_SOURCE }, slot)),
    PdfRadio: slot => page(() => h(PdfRadio, { name: 'd', value: 'x', style: { width: 9, height: 9 }, ...LEAF_SOURCE }, slot)),
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
    PdfLeader: slot => text(() => h(PdfLeader, LEAF_SOURCE, slot)),
    PdfPageNumber: slot => text(() => h(PdfPageNumber, LEAF_SOURCE, slot)),
    PdfPageCount: slot => text(() => h(PdfPageCount, LEAF_SOURCE, slot)),
    PdfPageRef: slot => text(() => h(PdfPageRef, { to: 'target', ...LEAF_SOURCE }, slot)),
    PdfRunningText: slot => page(() => [
      h(PdfText, { fixed: true }, () => h(PdfRunningText, { name: 'chapter', ...LEAF_SOURCE }, slot)),
      h(PdfText, { running: 'chapter' }, () => 'Chapter'),
    ]),
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

describe('texts with page tokens', () => {
  const { PdfPageCount, PdfRunningText } = PDF_COMPONENTS
  const TEXT_SOURCE = { [PDF_SOURCE_PROP]: 'footer.vue:6:9' }

  // Catches the per-page text rules failing late: the engine adapter
  // checked them while converting the tree, after mount, without the
  // template position, so the author got no file and line.
  it.each<[string, () => VNodeChild, string]>([
    ['a page count in a nested text', () => h(PdfText, { fixed: true }, () => ['Of ', h(PdfText, TEXT_SOURCE, () => h(PdfPageCount))]),
      '<PdfPageNumber> and <PdfPageCount> are not supported in a <PdfText> nested inside another <PdfText>.'],
    ['a page number beside a nested text', () => h(PdfText, { fixed: true, ...TEXT_SOURCE }, () => ['Page ', h(PdfPageNumber), h(PdfText, () => ' of the report')]),
      'A <PdfText> that contains <PdfPageNumber> or <PdfPageCount> cannot contain other elements.'],
    ['a running value beside a nested text', () => [h(PdfText, { fixed: true, ...TEXT_SOURCE }, () => [h(PdfRunningText, { name: 'chapter' }), h(PdfText, () => ' continued')]), h(PdfText, { running: 'chapter' }, () => 'One')],
      'A <PdfText> that contains <PdfRunningText> cannot contain other elements. Style the whole text, or put the other elements in a text of their own.'],
  ])('rejects %s at mount with its position', async (_name, content, message) => {
    await expect(mountPdfComponent(defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, null, content))))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message,
      source: { file: 'footer.vue', line: 6, column: 9 },
    })
  })
})

describe('em lengths', () => {
  // Catches an em length left as a string (dropped by the layout), resolved
  // against the inherited size on a node with its own, or not resolved on a
  // page (whose paddings the percent heights read before). Without padding
  // the text starts at x 0, top 9.
  it.each<[string, () => VNodeChild, PdfStyle, string[]]>([
    ['paddingTop on a view, of the inherited 10 pt', () => h(PdfView, { style: { paddingTop: '1em' } }, () => h(PdfText, () => 'x')), {}, ['x 0 19']],
    // 20 pt, not 10: the view's own size. The 20 pt text starts at top 18.
    ['marginLeft on a view with its own 20 pt', () => h(PdfView, { style: { fontSize: 20, marginLeft: '1em' } }, () => h(PdfText, () => 'x')), {}, ['x 20 18']],
    ['the padding shorthand on a view', () => h(PdfView, { style: { padding: '1em' } }, () => h(PdfText, () => 'x')), {}, ['x 10 19']],
    ['gap in a column', () => h(PdfView, { style: { gap: '1em' } }, () => [h(PdfText, () => 'a'), h(PdfText, () => 'b')]), {}, ['a 0 9', 'b 0 30']],
    ['width on a centred text', () => h(PdfView, { style: { alignItems: 'center' } }, () => h(PdfText, { style: { width: '4em' } }, () => 'x')), {}, ['x 80 9']],
    ['padding on the page', () => h(PdfText, () => 'x'), { padding: '1em' }, ['x 10 19']],
  ])('places a text with %s', async (_name, children, pageStyle, runs) => {
    expect(await runsOf(children, pageStyle)).toEqual(runs)
  })
})

describe('spaces at both ends of a text', () => {
  // A Vue template that puts a text's content on its own line gives it a
  // space at both ends. Catches a box that counts them: 'abc' (16.12 pt)
  // then ends 2.78 pt (a space) early per space in a right-aligned column,
  // and sits off centre in a centred one.
  it.each<[NonNullable<PdfStyle['alignItems']>, string]>([
    ['flex-end', 'abc 183.88'],
    ['center', 'abc 91.94'],
    ['flex-start', 'abc 0'],
  ])('places the glyphs of a shrunk text under alignItems %s as without them', async (alignItems, run) => {
    const runs = await runsOf(() => h(PdfView, { style: { alignItems } }, () => ['abc', ' abc', 'abc ', ' abc '].map(text => h(PdfText, () => text))))
    // "text left top": the four texts stack, so compare text and left only.
    expect(runs.map(text => text.trim().split(' ').slice(0, 2).join(' '))).toEqual([run, run, run, run])
  })
})
