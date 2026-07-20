// Shared source of truth for the style/layout conformance corpus.
//
// Both the React fixture (`styles-react.ts`) and the Vue fixture
// (`styles-vue.ts`) import THIS module and build structurally identical
// document trees from it, so any divergence in the resolved layout is the
// renderer boundary (Vue custom renderer → PDF node tree) rather than the test
// data. Every scenario is one page; the page order here is the contract both
// fixtures and the test walk in lockstep.

export type PdfStyle = Record<string, unknown>

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

  // (6) style arrays + falsy-entry filtering. The array MUST resolve to the
  // exact same box as `arrControl`.
  arrView: [
    { width: 60 },
    false,
    null,
    undefined,
    { height: 30, marginLeft: 12 },
  ] as unknown as PdfStyle,
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

  // (5) transform (rotate/scale/translate) on a View (visual). The box is
  // invariant under transform; only paint moves, so this page is raster-proved.
  transformBox: {
    position: 'absolute',
    top: 90,
    left: 90,
    width: 80,
    height: 40,
    backgroundColor: FILL_B,
    transform: 'rotate(25deg) scale(1.3) translate(6px, 4px)',
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
