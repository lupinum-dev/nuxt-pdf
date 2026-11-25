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
import type { DocumentNode, SafeDocumentNode } from '../../src/runtime/server/engine/layout/index'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mountPdfComponent } from '../../src/runtime/renderer'
import { bundlePdfFonts } from '../../src/build/fonts'
import { renderDocument } from '../engine-render'
import { createPdfFontStore } from '../../src/runtime/server/engine/fonts'
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
  decodePngPage,
  hasPdfHeader,
  parsePdf,
  rasterizePdf,
} from '../../src/test/pdf'
import { expectReviewedPage } from '../raster'

const fontPath = fileURLToPath(new URL(
  '../fixtures/assets/Roboto-Regular.ttf',
  import.meta.url,
))
const styleBaselineDirectory = fileURLToPath(new URL(
  '../fixtures/baselines/styles',
  import.meta.url,
))
const reviewedBoxesPath = fileURLToPath(new URL(
  '../fixtures/corpus/styles-boxes.json',
  import.meta.url,
))
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'

// Box comparisons use `toBeCloseTo(_, 2)` to absorb only float noise.

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

// A margin or padding that yoga computed as 0 may keep its style value
// ('auto', '0%'); it counts as 0.
const edgeOf = (value: number | string | undefined): number => typeof value === 'number' ? value : 0

const roundBox = (
  box: Record<string, number | string>,
): Record<string, number> => Object.fromEntries(BOX_KEYS.map(key => [key, Math.round(edgeOf(box[key]) * 1000) / 1000]))

/** Ordered element boxes per page: the layout fingerprint of the corpus. */
const orderedBoxesPerPage = (
  layout: SafeDocumentNode,
): Record<string, number>[][] =>
  documentPages(layout).map(page => elementNodes(page).map(n => roundBox(n.box!)))

const expectBoxClose = (
  actual: Record<string, number | string>,
  expected: Record<string, number | string>,
  label: string,
): void => {
  for (const key of BOX_KEYS) {
    expect(edgeOf(actual[key]), `${label}.${key}`).toBeCloseTo(edgeOf(expected[key]), 2)
  }
}

interface FontContext {
  fontStore: ReturnType<typeof createPdfFontStore>
  cleanup: () => Promise<void>
}

const setupFonts = async (): Promise<FontContext> => {
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

  it('resolves the reviewed layout boxes for the whole corpus', async () => {
    const vue = await renderVue(VueStylesDocument, {}, fonts.fontStore)
    expect(hasPdfHeader(vue.bytes)).toBe(true)

    // Per page, the ordered element boxes, written once from the output and
    // reviewed (styles-boxes.json); a change in any box shows here.
    const vuePages = orderedBoxesPerPage(vue.layout)
    expect(vuePages).toHaveLength(scenarios.length)
    expect(vuePages).toEqual(JSON.parse(await readFile(reviewedBoxesPath, 'utf8')))

    // The hand-computed boxes of each scenario.
    const vueById = boxesById(vue.layout)
    for (const scenario of scenarios) {
      for (const { id, expect: want } of scenario.oracle as BoxOracle[]) {
        const vBox = vueById.get(id)
        expect(vBox, `box ${id}`).toBeTruthy()
        for (const [key, value] of Object.entries(want as Record<string, number>)) {
          expect(vBox![key] as number, `${id}.${key}`).toBeCloseTo(value, 2)
        }
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
    const vue = await renderVue(
      VueStyleScenario,
      { scenario: 'style-values' },
      fonts.fontStore,
    )

    const vueById = nodesById(vue.layout)
    for (const { id, expectedStyle } of [...styleValueCases, ...textValueCases]) {
      expect(vueById.get(id)?.style, `style ${id}`).toEqual(
        expect.objectContaining(expectedStyle),
      )
    }

    const vuePdf = await parsePdf(vue.bytes)
    for (const { expectedText } of textValueCases) {
      expect(vuePdf.pages[0]?.text).toContain(expectedText)
    }
  }, 30_000)

  it('cascades media-less inherited fontSize through Views into Text', async () => {
    const vue = await renderVue(VueStylesDocument, {}, fonts.fontStore)

    const inheritedHeight = Number(boxesById(vue.layout).get('inhText')!.height ?? 0)
    const controlHeight = Number(boxesById(vue.layout).get('ctlText')!.height ?? 0)
    // Cascade proof: inherited text (page fontSize 20) is ~2x the control text
    // (own fontSize 10), because the default line box scales with fontSize.
    // Override proof: the control Text's own fontSize wins over the inherited 20.
    expect(controlHeight).toBeGreaterThan(0)
    expect(inheritedHeight).toBeGreaterThan(controlHeight * 1.6)
    expect(inheritedHeight / controlHeight).toBeCloseTo(2, 1)
  }, 30_000)

  it('resolves the closed border, radius, and text-decoration style contract', async () => {
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
      expect(nodesById(vue.layout).get(id)?.style, `style ${id}`).toEqual(
        expect.objectContaining(expectedStyle),
      )
    }
  }, 30_000)

  it('extracts the page text, including inherited Text', async () => {
    const vue = await renderVue(VueStylesDocument, {}, fonts.fontStore)
    const vuePdf = await parsePdf(vue.bytes)
    expect(vuePdf.pageCount).toBe(scenarios.length)
    expect(vuePdf.pages.map(p => p.text)).toEqual([
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'Nuxt none Nuxt Pdf Capitalize nuxt pdf lowercase NUXT PDF UPPERCASE Decoration none Decoration underline Decoration line-through Decoration underline line-through Decoration line-through underline',
      '',
      '',
      '',
      '',
      '',
      'Inherited cascade Own size control',
      '',
      'Decorated style contract',
      '',
      '',
    ])

    const inheritIndex = scenarios.findIndex(s => s.id === 'inherited-props')
    expect(vuePdf.pages[inheritIndex]?.text).toContain(INHERIT_TEXT)
    expect(vuePdf.pages[inheritIndex]?.text).toContain(CONTROL_TEXT)
  }, 30_000)

  // Visual scenarios: box geometry cannot see painting (backgroundColor,
  // opacity, transform) or prove a border is actually stroked, so each page
  // has a reviewed baseline.
  it.each(visualScenarioIds)('paints %s as its reviewed baseline', async (id) => {
    const vue = await renderVue(VueStyleScenario, { scenario: id }, fonts.fontStore)
    const vuePages = await rasterizePdf(vue.bytes)
    expect(vuePages).toHaveLength(1)
    const page = vuePages[0]!

    const baselinePath = join(styleBaselineDirectory, `${id}.png`)
    if (updatePdfBaselines) {
      await mkdir(styleBaselineDirectory, { recursive: true })
      await writeFile(baselinePath, page.png)
    }
    const baseline = await decodePngPage(await readFile(baselinePath), page.number)
    await expectReviewedPage(page, baseline, `styles-${id}`)
  }, 30_000)
})
