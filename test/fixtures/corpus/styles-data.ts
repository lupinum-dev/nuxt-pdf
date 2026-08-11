import type {
  PdfStyle,
  PdfStyleValue,
} from '../../../src/runtime/authoring'

// Shared source of truth for the style/layout conformance corpus.
//
// Both the React fixture (`styles-react.ts`) and the Vue fixture
// (`styles-vue.ts`) import THIS module and build structurally identical
// document trees from it, so any divergence in the resolved layout is the
// renderer boundary (Vue custom renderer → PDF node tree) rather than the test
// data. Every scenario is one page; the page order here is the contract both
// fixtures and the test walk in lockstep.

export type { PdfStyle, PdfStyleValue }

export interface PdfSize {
  width: number
  height: number
}

/** A tagged box the test locates by `id` in the resolved layout tree. */
export interface BoxOracle {
  id: string
  /** Only the keys listed here are asserted (numeric, in points). */
  expect: Partial<Record<
    'left' | 'top' | 'width' | 'height'
    | 'marginLeft' | 'marginTop' | 'marginRight' | 'marginBottom'
    | 'paddingLeft' | 'paddingTop' | 'paddingRight' | 'paddingBottom'
    | 'borderLeftWidth' | 'borderTopWidth' | 'borderRightWidth' | 'borderBottomWidth',
    number
  >>
}

export type ScenarioKind = 'layout' | 'visual'

export interface Scenario {
  id: string
  kind: ScenarioKind
  /** Page geometry; padding is always zero unless a style sets it. */
  size: PdfSize
  /** Numeric box oracles (independent of React==Vue parity) for this page. */
  oracle: BoxOracle[]
}

// Deep, brand-neutral fills so the visual (raster) pages have real ink to prove
// painting, not just resolved boxes.
export const FILL_A = '#1f6feb'
export const FILL_B = '#d9480f'
export const BORDER_COLOR = '#0b2e59'
export const INK = '#16324f'
export const DECORATED_TEXT = 'Decorated style contract'

export interface StyleValueCase {
  id: string
  style: PdfStyle
  expectedStyle: Readonly<Record<string, unknown>>
}

export interface TextValueCase extends StyleValueCase {
  source: string
  expectedText: string
}

/** Every advertised scalar length unit, all resolving against a 720pt square. */
export const unitLengthCases = [
  { id: 'unitPt', style: { width: '72pt', height: 8 }, expectedWidth: 72 },
  { id: 'unitPx', style: { width: '96px', height: 8 }, expectedWidth: 96 },
  { id: 'unitIn', style: { width: '1in', height: 8 }, expectedWidth: 72 },
  { id: 'unitMm', style: { width: '25.4mm', height: 8 }, expectedWidth: 72 },
  { id: 'unitCm', style: { width: '2.54cm', height: 8 }, expectedWidth: 72 },
  { id: 'unitRem', style: { width: '4rem', height: 8 }, expectedWidth: 72 },
  { id: 'unitVw', style: { width: '10vw', height: 8 }, expectedWidth: 72 },
  { id: 'unitVh', style: { width: '10vh', height: 8 }, expectedWidth: 72 },
] as const satisfies readonly {
  id: string
  style: PdfStyle
  expectedWidth: number
}[]

const fontWeightCases = [
  ['weightThin', 'thin', 100],
  ['weightHairline', 'hairline', 100],
  ['weightUltralight', 'ultralight', 200],
  ['weightExtralight', 'extralight', 200],
  ['weightLight', 'light', 300],
  ['weightNormal', 'normal', 400],
  ['weightMedium', 'medium', 500],
  ['weightSemibold', 'semibold', 600],
  ['weightDemibold', 'demibold', 600],
  ['weightBold', 'bold', 700],
  ['weightUltrabold', 'ultrabold', 800],
  ['weightExtrabold', 'extrabold', 800],
  ['weightHeavy', 'heavy', 900],
  ['weightBlack', 'black', 900],
] as const

/**
 * Closed enum and transform grammar. Empty tagged Views are sufficient here:
 * the assertion reads the pinned stylesheet engine's resolved style, while
 * paired React/Vue layout still proves the custom-renderer boundary.
 */
export const styleValueCases: readonly StyleValueCase[] = [
  ...(['row', 'row-reverse', 'column', 'column-reverse'] as const).map(value => ({
    id: `direction-${value}`,
    style: { flexDirection: value, height: 1, width: 1 },
    expectedStyle: { flexDirection: value },
  })),
  ...(['nowrap', 'wrap', 'wrap-reverse'] as const).map(value => ({
    id: `wrap-${value}`,
    style: { flexWrap: value, height: 1, width: 1 },
    expectedStyle: { flexWrap: value },
  })),
  ...(['flex-start', 'flex-end', 'center', 'stretch', 'baseline'] as const).map(value => ({
    id: `align-${value}`,
    style: { alignItems: value, height: 1, width: 1 },
    expectedStyle: { alignItems: value },
  })),
  ...([
    'flex-start',
    'flex-end',
    'center',
    'space-between',
    'space-around',
    'space-evenly',
  ] as const).map(value => ({
    id: `justify-${value}`,
    style: { height: 1, justifyContent: value, width: 1 },
    expectedStyle: { justifyContent: value },
  })),
  ...(['normal', 'italic', 'oblique'] as const).map(value => ({
    id: `font-style-${value}`,
    style: { fontStyle: value, height: 1, width: 1 },
    expectedStyle: { fontStyle: value },
  })),
  ...fontWeightCases.map(([id, value, normalized]) => ({
    id,
    style: { fontWeight: value, height: 1, width: 1 },
    expectedStyle: { fontWeight: normalized },
  })),
  ...(['left', 'right', 'center', 'justify'] as const).map(value => ({
    id: `text-align-${value}`,
    style: { height: 1, textAlign: value, width: 1 },
    expectedStyle: { textAlign: value },
  })),
  {
    id: 'position-relative',
    style: { height: 1, position: 'relative', width: 1 },
    expectedStyle: { position: 'relative' },
  },
  {
    id: 'transform-radians',
    style: { height: 1, transform: 'rotate(0.5rad)', width: 1 },
    expectedStyle: {
      transform: [{ operation: 'rotate', value: [0.5 * 180 / Math.PI, 0, 0] }],
    },
  },
  {
    id: 'transform-scale-comma',
    style: { height: 1, transform: 'scale(2,3)', width: 1 },
    expectedStyle: { transform: [{ operation: 'scale', value: [2, 3] }] },
  },
  {
    id: 'transform-scale-comma-space',
    style: { height: 1, transform: 'scale(2, 3)', width: 1 },
    expectedStyle: { transform: [{ operation: 'scale', value: [2, 3] }] },
  },
  {
    id: 'transform-scale-space',
    style: { height: 1, transform: 'scale(2 3)', width: 1 },
    expectedStyle: { transform: [{ operation: 'scale', value: [2, 3] }] },
  },
  {
    id: 'transform-translate-comma',
    style: { height: 1, transform: 'translate(2,3)', width: 1 },
    expectedStyle: { transform: [{ operation: 'translate', value: [2, 3] }] },
  },
  {
    id: 'transform-translate-comma-space',
    style: { height: 1, transform: 'translate(2, 3)', width: 1 },
    expectedStyle: { transform: [{ operation: 'translate', value: [2, 3] }] },
  },
  {
    id: 'transform-translate-space',
    style: { height: 1, transform: 'translate(2 3)', width: 1 },
    expectedStyle: { transform: [{ operation: 'translate', value: [2, 3] }] },
  },
]

/** Text values need real glyph output so transformations and decorations paint. */
export const textValueCases: readonly TextValueCase[] = [
  {
    id: 'text-transform-none',
    source: 'Nuxt none',
    expectedText: 'Nuxt none',
    style: { fontFamily: 'Roboto', fontSize: 10, textTransform: 'none' },
    expectedStyle: { textTransform: 'none' },
  },
  {
    id: 'text-transform-capitalize',
    source: 'nuxt pdf capitalize',
    expectedText: 'Nuxt Pdf Capitalize',
    style: { fontFamily: 'Roboto', fontSize: 10, textTransform: 'capitalize' },
    expectedStyle: { textTransform: 'capitalize' },
  },
  {
    id: 'text-transform-lowercase',
    source: 'NUXT PDF LOWERCASE',
    expectedText: 'nuxt pdf lowercase',
    style: { fontFamily: 'Roboto', fontSize: 10, textTransform: 'lowercase' },
    expectedStyle: { textTransform: 'lowercase' },
  },
  {
    id: 'text-transform-uppercase',
    source: 'nuxt pdf uppercase',
    expectedText: 'NUXT PDF UPPERCASE',
    style: { fontFamily: 'Roboto', fontSize: 10, textTransform: 'uppercase' },
    expectedStyle: { textTransform: 'uppercase' },
  },
  ...([
    ['decoration-none', 'none'],
    ['decoration-underline', 'underline'],
    ['decoration-line-through', 'line-through'],
    ['decoration-both-underline-first', 'underline line-through'],
    ['decoration-both-line-first', 'line-through underline'],
  ] as const).map(([id, value]) => ({
    id,
    source: `Decoration ${value}`,
    expectedText: `Decoration ${value}`,
    style: {
      fontFamily: 'Roboto',
      fontSize: 10,
      textDecoration: value,
    },
    // The pinned stylesheet canonicalizes authored `none` to an empty value.
    expectedStyle: { textDecoration: value === 'none' ? '' : value },
  })),
]

// --- Reusable style fragments (one object, both renderers) -------------------

export const styles = {
  page: { padding: 0 },

  // (1) flexbox — row with a growing middle child.
  rowGrow: { flexDirection: 'row', height: 100 } as PdfStyle,
  rowGrowA: { width: 50, height: 100 } as PdfStyle,
  rowGrowB: { flexGrow: 1, height: 100 } as PdfStyle,
  rowGrowC: { width: 50, height: 100 } as PdfStyle,

  // (1) flexbox — column with a growing middle child inside a fixed height.
  col: { flexDirection: 'column', height: 200, width: 200 } as PdfStyle,
  colA: { height: 30 } as PdfStyle,
  colB: { flexGrow: 1 } as PdfStyle,
  colC: { height: 30 } as PdfStyle,

  // (1) flexbox — flexBasis + flexShrink resolving an over-committed row.
  basisRow: { flexDirection: 'row', width: 200, height: 40 } as PdfStyle,
  basisChild: { flexBasis: 150, flexShrink: 1, height: 40 } as PdfStyle,

  // (1) flexbox — alignItems + justifyContent.
  alignRow: {
    flexDirection: 'row',
    height: 100,
    justifyContent: 'space-between',
    alignItems: 'center',
  } as PdfStyle,
  alignChild: { width: 40, height: 20 } as PdfStyle,

  // (1) flexbox — gap.
  gapRow: { flexDirection: 'row', gap: 10, height: 20 } as PdfStyle,
  gapChild: { width: 40, height: 20 } as PdfStyle,

  // Explicit auto-value behavior: horizontal auto margins center a fixed box,
  // while an auto flex basis takes the child's authored width.
  autoMarginParent: { width: 200, height: 20 } as PdfStyle,
  autoMarginChild: {
    width: 50,
    height: 10,
    marginHorizontal: 'auto',
  } as PdfStyle,
  autoBasisRow: { flexDirection: 'row', width: 200, height: 20 } as PdfStyle,
  autoBasisChild: { flexBasis: 'auto', width: 60, height: 20 } as PdfStyle,
  autoBasisSibling: { width: 40, height: 20 } as PdfStyle,

  // (2) percent widths/heights against page and nested container.
  pctOuter: { width: '50%', height: '25%' } as PdfStyle,
  pctInner: { width: '50%', height: '50%', backgroundColor: FILL_A } as PdfStyle,

  // (3) margins/paddings/borders.
  mpbBox: {
    width: 100,
    height: 60,
    margin: 10,
    padding: 8,
    borderWidth: 4,
    borderColor: BORDER_COLOR,
    backgroundColor: '#ffffff',
  } as PdfStyle,

  // Dimension constraints + vertical-margin shorthand. These stay in normal
  // flow so the resolved Yoga box is an independent numeric oracle.
  minWidthBox: {
    width: 20,
    minWidth: 70,
    height: 20,
    marginVertical: 6,
  } as PdfStyle,
  maxHeightBox: {
    width: 50,
    height: 80,
    maxHeight: 30,
    marginVertical: 7,
  } as PdfStyle,

  // (6) recursively nested style arrays + falsy-entry filtering. The array
  // MUST resolve to the exact same box as `arrControl`.
  arrView: [
    { width: 60 },
    false,
    [null, [{ height: 30 }, undefined]],
    { marginLeft: 12 },
  ] satisfies PdfStyleValue,
  arrControl: { width: 60, height: 30, marginLeft: 12 } as PdfStyle,

  // (7) backgroundColor + opacity (visual).
  opaqueBox: {
    position: 'absolute',
    top: 20,
    left: 20,
    width: 120,
    height: 120,
    backgroundColor: FILL_A,
  } as PdfStyle,
  opacityBox: {
    position: 'absolute',
    top: 60,
    left: 60,
    width: 120,
    height: 120,
    backgroundColor: FILL_B,
    opacity: 0.5,
  } as PdfStyle,

  // (3)+(visual) border rendering raster proof.
  borderBox: {
    position: 'absolute',
    top: 30,
    left: 30,
    width: 140,
    height: 100,
    borderWidth: 6,
    borderColor: BORDER_COLOR,
    backgroundColor: '#ffffff',
  } as PdfStyle,

  // Closed style-surface paint proof. One compact page covers generic and
  // edge-specific border styles, every radius spelling, and decorated text.
  styledBorderBox: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 72,
    height: 50,
    borderWidth: 4,
    borderColor: BORDER_COLOR,
    borderStyle: 'dashed',
    borderRadius: 14,
    backgroundColor: '#ffffff',
  } as PdfStyle,
  styledEdgesBox: {
    position: 'absolute',
    top: 16,
    left: 112,
    width: 90,
    height: 50,
    borderWidth: 3,
    borderColor: BORDER_COLOR,
    borderStyle: 'solid',
    borderTopStyle: 'dashed',
    borderRightWidth: 9,
    borderRightColor: FILL_B,
    borderRightStyle: 'dotted',
    borderLeftStyle: 'dashed',
    backgroundColor: '#ffffff',
  } as PdfStyle,
  cornerRadiiBox: {
    position: 'absolute',
    top: 16,
    left: 230,
    width: 96,
    height: 80,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 20,
    borderBottomLeftRadius: 28,
    backgroundColor: FILL_A,
  } as PdfStyle,
  decoratedText: {
    position: 'absolute',
    top: 112,
    left: 16,
    fontFamily: 'Roboto',
    fontSize: 18,
    color: INK,
    textDecoration: 'underline',
    textDecorationColor: FILL_B,
    textDecorationStyle: 'dashed',
  } as PdfStyle,

  // (5) transform (rotate/scale/translate) on a View (visual). The box is
  // invariant under transform; only paint moves, so this page is raster-proved.
  transformBox: {
    position: 'absolute',
    top: 90,
    left: 90,
    width: 80,
    height: 40,
    backgroundColor: FILL_B,
    transform: 'rotate(25deg) scale(1.3) translate(6, 4)',
  } as PdfStyle,
} as const

// (7) media-less inherited props: the page sets fontFamily/fontSize/color; two
// Views nest a Text that sets NO own fontSize/color, proving the cascade. A
// sibling control Text overrides fontSize to 10.
export const INHERIT_FONT = 'Roboto'
export const INHERIT_FONT_SIZE = 20
export const CONTROL_FONT_SIZE = 10
export const INHERIT_COLOR = '#7b2d8b'
export const INHERIT_TEXT = 'Inherited cascade'
export const CONTROL_TEXT = 'Own size control'

export const inheritPageStyle: PdfStyle = {
  padding: 12,
  fontFamily: INHERIT_FONT,
  fontSize: INHERIT_FONT_SIZE,
  color: INHERIT_COLOR,
}
export const inheritWrapOuter: PdfStyle = { paddingLeft: 8 }
export const inheritWrapInner: PdfStyle = { paddingLeft: 8 }
export const controlTextStyle: PdfStyle = { fontSize: CONTROL_FONT_SIZE }

// --- Scenario order + oracles (the contract) ---------------------------------

export const scenarios: Scenario[] = [
  {
    id: 'flex-row-grow',
    kind: 'layout',
    size: { width: 300, height: 200 },
    oracle: [
      { id: 'rowGrowA', expect: { left: 0, width: 50, height: 100 } },
      { id: 'rowGrowB', expect: { left: 50, width: 200, height: 100 } },
      { id: 'rowGrowC', expect: { left: 250, width: 50, height: 100 } },
    ],
  },
  {
    id: 'flex-column',
    kind: 'layout',
    size: { width: 200, height: 300 },
    oracle: [
      { id: 'colA', expect: { top: 0, height: 30, width: 200 } },
      { id: 'colB', expect: { top: 30, height: 140, width: 200 } },
      { id: 'colC', expect: { top: 170, height: 30, width: 200 } },
    ],
  },
  {
    id: 'flex-basis-shrink',
    kind: 'layout',
    size: { width: 200, height: 200 },
    oracle: [
      { id: 'basisA', expect: { left: 0, width: 100 } },
      { id: 'basisB', expect: { left: 100, width: 100 } },
    ],
  },
  {
    id: 'flex-align-justify',
    kind: 'layout',
    size: { width: 300, height: 120 },
    oracle: [
      { id: 'alignA', expect: { left: 0, top: 40, width: 40, height: 20 } },
      { id: 'alignB', expect: { left: 130, top: 40 } },
      { id: 'alignC', expect: { left: 260, top: 40 } },
    ],
  },
  {
    id: 'flex-gap',
    kind: 'layout',
    size: { width: 200, height: 100 },
    oracle: [
      { id: 'gapA', expect: { left: 0, width: 40 } },
      { id: 'gapB', expect: { left: 50, width: 40 } },
      { id: 'gapC', expect: { left: 100, width: 40 } },
    ],
  },
  {
    id: 'auto-layout-values',
    kind: 'layout',
    size: { width: 200, height: 100 },
    oracle: [
      { id: 'autoMarginChild', expect: { left: 75, width: 50 } },
      { id: 'autoBasisChild', expect: { left: 0, width: 60 } },
      { id: 'autoBasisSibling', expect: { left: 60, width: 40 } },
    ],
  },
  {
    id: 'length-units',
    kind: 'layout',
    size: { width: 720, height: 720 },
    oracle: unitLengthCases.map(({ id, expectedWidth }) => ({
      id,
      expect: { width: expectedWidth },
    })),
  },
  {
    id: 'style-values',
    kind: 'visual',
    size: { width: 240, height: 360 },
    oracle: [],
  },
  {
    id: 'percent',
    kind: 'layout',
    size: { width: 400, height: 300 },
    oracle: [
      { id: 'pctOuter', expect: { left: 0, top: 0, width: 200, height: 75 } },
      { id: 'pctInner', expect: { left: 0, top: 0, width: 100, height: 37.5 } },
    ],
  },
  {
    id: 'margin-padding-border',
    kind: 'layout',
    size: { width: 200, height: 200 },
    oracle: [
      {
        id: 'mpbBox',
        expect: {
          left: 10,
          top: 10,
          width: 100,
          height: 60,
          marginLeft: 10,
          marginTop: 10,
          marginRight: 10,
          marginBottom: 10,
          paddingLeft: 8,
          paddingTop: 8,
          paddingRight: 8,
          paddingBottom: 8,
          borderLeftWidth: 4,
          borderTopWidth: 4,
          borderRightWidth: 4,
          borderBottomWidth: 4,
        },
      },
    ],
  },
  {
    id: 'dimension-constraints',
    kind: 'layout',
    size: { width: 200, height: 140 },
    oracle: [
      {
        id: 'minWidthBox',
        expect: {
          width: 70,
          height: 20,
          marginTop: 6,
          marginBottom: 6,
        },
      },
      {
        id: 'maxHeightBox',
        expect: {
          width: 50,
          height: 30,
          marginTop: 7,
          marginBottom: 7,
        },
      },
    ],
  },
  {
    id: 'style-array-falsy',
    kind: 'layout',
    size: { width: 200, height: 200 },
    oracle: [
      { id: 'arrBox', expect: { left: 12, top: 0, width: 60, height: 30, marginLeft: 12 } },
    ],
  },
  {
    id: 'style-object-control',
    kind: 'layout',
    size: { width: 200, height: 200 },
    oracle: [
      { id: 'objBox', expect: { left: 12, top: 0, width: 60, height: 30, marginLeft: 12 } },
    ],
  },
  {
    id: 'inherited-props',
    kind: 'visual',
    size: { width: 260, height: 160 },
    oracle: [],
  },
  {
    id: 'border',
    kind: 'visual',
    size: { width: 200, height: 160 },
    oracle: [
      {
        id: 'borderBox',
        expect: {
          left: 30,
          top: 30,
          width: 140,
          height: 100,
          borderLeftWidth: 6,
          borderTopWidth: 6,
          borderRightWidth: 6,
          borderBottomWidth: 6,
        },
      },
    ],
  },
  {
    id: 'closed-style-paint',
    kind: 'visual',
    size: { width: 350, height: 155 },
    oracle: [],
  },
  {
    id: 'background-opacity',
    kind: 'visual',
    size: { width: 200, height: 200 },
    oracle: [],
  },
  {
    id: 'transform',
    kind: 'visual',
    size: { width: 260, height: 220 },
    oracle: [
      // Box is invariant under transform: same geometry as an untransformed
      // 80x40 absolute box at (90,90). Only paint rotates/scales/translates.
      { id: 'transformBox', expect: { left: 90, top: 90, width: 80, height: 40 } },
    ],
  },
]

/** Page order == scenario order; visual pages get React/Vue raster parity. */
export const scenarioIds = scenarios.map(s => s.id)
export const visualScenarioIds = scenarios
  .filter(s => s.kind === 'visual')
  .map(s => s.id)
