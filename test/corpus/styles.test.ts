import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DocumentNode, SafeDocumentNode } from '@react-pdf/layout'
import {
  Font as ReactFont,
  renderToBuffer as renderReactDocument,
} from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mountPdfComponent } from '../../src/runtime/renderer'
import { bundlePdfFonts } from '../../src/build/fonts'
import { renderDocument } from '../../src/runtime/server/engine/render-document'
import { createPdfFontStore } from '../../src/runtime/server/fonts'
import {
  createReactStyleScenario,
  createReactStylesDocument,
} from '../fixtures/corpus/styles-react'
import {
  VueStyleScenario,
  VueStylesDocument,
} from '../fixtures/corpus/styles-vue'
import {
  CONTROL_TEXT,
  INHERIT_TEXT,
  scenarios,
  styleValueCases,
  textValueCases,
  visualScenarioIds,
  type BoxOracle,
} from '../fixtures/corpus/styles-data'
import {
  comparePageImages,
  decodePngPage,
  hasPdfHeader,
  parsePdf,
  rasterizePdf,
} from '../utils/pdf'

const fontPath = fileURLToPath(new URL(
  '../fixtures/assets/Roboto-Regular.ttf',
  import.meta.url,
))
const closedStyleBaselinePath = fileURLToPath(new URL(
  '../fixtures/baselines/styles/closed-style-paint.png',
  import.meta.url,
))
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'

// Layout numbers come from the same Yoga engine on both sides, so parity is
// exact; box comparisons use `toBeCloseTo(_, 2)` to absorb only float noise.
const rasterThresholds = {
  channelThreshold: 25,
  maxChangedPixelRatio: 0.005,
} as const

const BOX_KEYS = [
  'left', 'top', 'right', 'bottom', 'width', 'height',
  'marginLeft', 'marginTop', 'marginRight', 'marginBottom',
  'paddingLeft', 'paddingTop', 'paddingRight', 'paddingBottom',
  'borderLeftWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
] as const

type LayoutNode = {
  type?: string
  props?: Record<string, unknown>
  style?: Record<string, unknown>
  box?: Record<string, number | string>
  children?: unknown
}

const asNodes = (value: unknown): LayoutNode[] =>
  Array.isArray(value) ? value as LayoutNode[] : []

/** Every element node (has `props` + `box`) under `node`, depth-first. */
const elementNodes = (node: LayoutNode): LayoutNode[] => {
  const here = node.props && node.box ? [node] : []
  return here.concat(asNodes(node.children).flatMap(elementNodes))
}

const documentPages = (layout: SafeDocumentNode): LayoutNode[] =>
  asNodes((layout as unknown as LayoutNode).children)

/** id → resolved element node, across every page of a laid-out document. */
const nodesById = (layout: SafeDocumentNode): Map<string, LayoutNode> => {
  const map = new Map<string, LayoutNode>()
  for (const page of documentPages(layout)) {
    for (const node of elementNodes(page)) {
      const id = node.props?.id
      if (typeof id === 'string') map.set(id, node)
    }
  }
  return map
}

/** id → resolved box, across every page of a laid-out document. */
const boxesById = (layout: SafeDocumentNode): Map<string, Record<string, number | string>> => {
  const map = new Map<string, Record<string, number | string>>()
  for (const [id, node] of nodesById(layout)) {
    if (node.box) map.set(id, node.box)
  }
  return map
}

const roundBox = (
  box: Record<string, number | string>,
): Record<string, number | string> => Object.fromEntries(BOX_KEYS.map((key) => {
  const value = box[key] ?? 0
  return [
    key,
    typeof value === 'number' ? Math.round(value * 1000) / 1000 : value,
  ]
}))

/** Ordered element boxes per page — the structural parity fingerprint. */
const orderedBoxesPerPage = (
  layout: SafeDocumentNode,
): Record<string, number | string>[][] =>
  documentPages(layout).map(page => elementNodes(page).map(n => roundBox(n.box!)))

const expectBoxClose = (
  actual: Record<string, number | string>,
  expected: Record<string, number | string>,
  label: string,
): void => {
  for (const key of BOX_KEYS) {
    const actualValue = actual[key] ?? 0
    const expectedValue = expected[key] ?? 0
    if (typeof actualValue === 'number' && typeof expectedValue === 'number') {
      expect(actualValue, `${label}.${key}`).toBeCloseTo(expectedValue, 2)
    }
    else {
      expect(actualValue, `${label}.${key}`).toBe(expectedValue)
    }
  }
}

const captureReactLayout = async (
  element: ReactElement,
): Promise<{ bytes: Uint8Array, layout: SafeDocumentNode }> => {
  let layout: SafeDocumentNode | undefined
  // react-pdf calls Document.onRender with the resolved layout tree
  // (`_INTERNAL__LAYOUT__DATA_`) — this is React's own layout result, the oracle.
  const withHook = {
    ...element,
    props: {
      ...(element.props as Record<string, unknown>),
      onRender: (payload: { _INTERNAL__LAYOUT__DATA_: SafeDocumentNode }) => {
        layout = payload._INTERNAL__LAYOUT__DATA_
      },
    },
  } as Parameters<typeof renderReactDocument>[0]
  const bytes = new Uint8Array(await renderReactDocument(withHook))
  if (!layout) throw new Error('React onRender did not deliver layout data')
  return { bytes, layout }
}

interface FontContext {
  fontStore: ReturnType<typeof createPdfFontStore>
  cleanup: () => Promise<void>
}

const setupFonts = async (): Promise<FontContext> => {
  ReactFont.register({ family: 'Roboto', src: fontPath })
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-styles-font-'))
  const fontRoot = join(temporaryRoot, 'pdfs/fonts')
  const bundledFontPath = join(fontRoot, 'Roboto-Regular.ttf')
  await mkdir(dirname(bundledFontPath), { recursive: true })
  await copyFile(fontPath, bundledFontPath)
  const fonts = await bundlePdfFonts(
    [{ family: 'Roboto', src: 'Roboto-Regular.ttf' }],
    { fontRoots: [fontRoot] },
  )
  return {
    fontStore: createPdfFontStore(fonts),
    cleanup: () => rm(temporaryRoot, { force: true, recursive: true }),
  }
}

const renderVue = async (
  component: Parameters<typeof mountPdfComponent>[0],
  props: Record<string, unknown>,
  fontStore: FontContext['fontStore'],
) => {
  const mounted = await mountPdfComponent(component, props)
  try {
    return await renderDocument(mounted.document as unknown as DocumentNode, { fontStore })
  }
  finally {
    mounted.unmount()
  }
}

describe('style and layout resolution conformance', () => {
  let fonts: FontContext

  beforeAll(async () => {
    fonts = await setupFonts()
  })
  afterAll(async () => {
    await fonts?.cleanup()
  })

  it('resolves the same layout boxes from React and Vue for the whole corpus', async () => {
    const react = await captureReactLayout(createReactStylesDocument() as ReactElement)
    const vue = await renderVue(VueStylesDocument, {}, fonts.fontStore)

    expect(hasPdfHeader(react.bytes)).toBe(true)
    expect(hasPdfHeader(vue.bytes)).toBe(true)

    // Structural parity: identical page count and, per page, identical ordered
    // element boxes. This alone catches any renderer-boundary divergence.
    const reactPages = orderedBoxesPerPage(react.layout)
    const vuePages = orderedBoxesPerPage(vue.layout)
    expect(vuePages).toHaveLength(scenarios.length)
    expect(reactPages).toHaveLength(scenarios.length)
    expect(vuePages).toEqual(reactPages)

    // Independent numeric oracle per scenario (catches BOTH sides drifting).
    const reactById = boxesById(react.layout)
    const vueById = boxesById(vue.layout)
    for (const scenario of scenarios) {
      for (const { id, expect: want } of scenario.oracle as BoxOracle[]) {
        const partial = want as Record<string, number>
        const rBox = reactById.get(id)
        const vBox = vueById.get(id)
        expect(rBox, `react box ${id}`).toBeTruthy()
        expect(vBox, `vue box ${id}`).toBeTruthy()
        for (const [key, value] of Object.entries(partial)) {
          expect(rBox![key] as number, `react ${id}.${key}`).toBeCloseTo(value, 2)
          expect(vBox![key] as number, `vue ${id}.${key}`).toBeCloseTo(value, 2)
        }
        expectBoxClose(vBox!, rBox!, `parity ${id}`)
      }
    }
  }, 30_000)

  it('resolves style arrays with falsy entries identically to the object form', async () => {
    const vue = await renderVue(VueStylesDocument, {}, fonts.fontStore)
    const byId = boxesById(vue.layout)
    const arr = byId.get('arrBox')
    const obj = byId.get('objBox')
    expect(arr).toBeTruthy()
    expect(obj).toBeTruthy()
    // The filtered array [{width},false,null,undefined,{height,marginLeft}]
    // must resolve to the exact same box as the single merged object.
    expectBoxClose(arr!, obj!, 'array-vs-object')
  }, 20_000)

  it('resolves every retained enum, font-weight alias, and transform spelling', async () => {
    const react = await captureReactLayout(
      createReactStyleScenario('style-values') as ReactElement,
    )
    const vue = await renderVue(
      VueStyleScenario,
      { scenario: 'style-values' },
      fonts.fontStore,
    )

    const reactById = nodesById(react.layout)
    const vueById = nodesById(vue.layout)
    for (const { id, expectedStyle } of [...styleValueCases, ...textValueCases]) {
      expect(reactById.get(id)?.style, `react style ${id}`).toEqual(
        expect.objectContaining(expectedStyle),
      )
      expect(vueById.get(id)?.style, `vue style ${id}`).toEqual(
        expect.objectContaining(expectedStyle),
      )
    }

    const [reactPdf, vuePdf] = await Promise.all([
      parsePdf(react.bytes),
      parsePdf(vue.bytes),
    ])
    for (const { expectedText } of textValueCases) {
      expect(reactPdf.pages[0]?.text).toContain(expectedText)
      expect(vuePdf.pages[0]?.text).toContain(expectedText)
    }
  }, 30_000)

  it('cascades media-less inherited fontSize through Views into Text', async () => {
    const react = await captureReactLayout(createReactStylesDocument() as ReactElement)
    const vue = await renderVue(VueStylesDocument, {}, fonts.fontStore)

    const rInh = boxesById(react.layout).get('inhText')!
    const rCtl = boxesById(react.layout).get('ctlText')!
    const vInh = boxesById(vue.layout).get('inhText')!
    const vCtl = boxesById(vue.layout).get('ctlText')!

    const rInhH = Number(rInh.height ?? 0)
    const rCtlH = Number(rCtl.height ?? 0)
    // Cascade proof: inherited text (page fontSize 20) is ~2x the control text
    // (own fontSize 10), because the default line box scales with fontSize.
    expect(rCtlH).toBeGreaterThan(0)
    expect(rInhH).toBeGreaterThan(rCtlH * 1.6)
    expect(rInhH / rCtlH).toBeCloseTo(2, 1)
    // Override proof: the control Text's own fontSize wins over the inherited 20.
    // Vue matches React's resolved geometry on both nodes.
    expectBoxClose(vInh, rInh, 'inherited-text')
    expectBoxClose(vCtl, rCtl, 'control-text')
  }, 30_000)

  it('resolves the closed border, radius, and text-decoration style contract', async () => {
    const react = await captureReactLayout(
      createReactStyleScenario('closed-style-paint') as ReactElement,
    )
    const vue = await renderVue(
      VueStyleScenario,
      { scenario: 'closed-style-paint' },
      fonts.fontStore,
    )

    const expectedById: Record<string, Record<string, unknown>> = {
      // borderStyle and borderRadius expand to the four concrete edges/corners.
      styledBorderBox: {
        borderTopStyle: 'dashed',
        borderRightStyle: 'dashed',
        borderBottomStyle: 'dashed',
        borderLeftStyle: 'dashed',
        borderTopLeftRadius: 14,
        borderTopRightRadius: 14,
        borderBottomRightRadius: 14,
        borderBottomLeftRadius: 14,
      },
      styledEdgesBox: {
        borderTopStyle: 'dashed',
        borderRightWidth: 9,
        borderRightColor: '#d9480f',
        borderRightStyle: 'dotted',
        borderLeftStyle: 'dashed',
      },
      cornerRadiiBox: {
        borderTopLeftRadius: 4,
        borderTopRightRadius: 12,
        borderBottomRightRadius: 20,
        borderBottomLeftRadius: 28,
      },
      decoratedText: {
        textDecorationColor: '#d9480f',
        textDecorationStyle: 'dashed',
      },
    }

    for (const [id, expectedStyle] of Object.entries(expectedById)) {
      const reactNode = nodesById(react.layout).get(id)
      const vueNode = nodesById(vue.layout).get(id)
      expect(reactNode?.style, `react style ${id}`).toEqual(
        expect.objectContaining(expectedStyle),
      )
      expect(vueNode?.style, `vue style ${id}`).toEqual(
        expect.objectContaining(expectedStyle),
      )
    }

    const [page] = await rasterizePdf(vue.bytes)
    if (updatePdfBaselines) {
      await mkdir(dirname(closedStyleBaselinePath), { recursive: true })
      await writeFile(closedStyleBaselinePath, page!.png)
    }
    const baseline = await decodePngPage(
      await readFile(closedStyleBaselinePath),
      page!.number,
    )
    expect(
      comparePageImages(page!, baseline, rasterThresholds),
      'closed style contract reviewed baseline mismatch',
    ).toMatchObject({
      dimensionsMatch: true,
      matches: true,
      pageNumbersMatch: true,
    })
  }, 30_000)

  it('extracts the same page text from React and Vue, including inherited Text', async () => {
    const react = await captureReactLayout(createReactStylesDocument() as ReactElement)
    const vue = await renderVue(VueStylesDocument, {}, fonts.fontStore)

    const [reactPdf, vuePdf] = await Promise.all([
      parsePdf(react.bytes),
      parsePdf(vue.bytes),
    ])
    expect(reactPdf.pageCount).toBe(scenarios.length)
    expect(vuePdf.pageCount).toBe(scenarios.length)
    expect(vuePdf.pages.map(p => p.text)).toEqual(reactPdf.pages.map(p => p.text))

    const inheritIndex = scenarios.findIndex(s => s.id === 'inherited-props')
    expect(vuePdf.pages[inheritIndex]?.text).toContain(INHERIT_TEXT)
    expect(vuePdf.pages[inheritIndex]?.text).toContain(CONTROL_TEXT)
  }, 30_000)

  // Visual scenarios: box geometry cannot see painting (backgroundColor,
  // opacity, transform) or prove a border is actually stroked. React is the
  // oracle — the Vue raster must match React's freshly rendered raster.
  it.each(visualScenarioIds)('paints %s identically to React (raster parity)', async (id) => {
    const react = await captureReactLayout(createReactStyleScenario(id) as ReactElement)
    const vue = await renderVue(VueStyleScenario, { scenario: id }, fonts.fontStore)

    const [reactPages, vuePages] = await Promise.all([
      rasterizePdf(react.bytes),
      rasterizePdf(vue.bytes),
    ])
    expect(reactPages).toHaveLength(1)
    expect(vuePages).toHaveLength(1)

    const parity = comparePageImages(vuePages[0]!, reactPages[0]!, rasterThresholds)
    expect(parity, `${id} React/Vue raster mismatch`).toMatchObject({
      dimensionsMatch: true,
      matches: true,
      pageNumbersMatch: true,
    })
  }, 30_000)
})
