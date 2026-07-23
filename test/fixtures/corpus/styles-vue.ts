import { defineComponent, h, type VNode } from 'vue'
import {
  PdfDocument,
  PdfPage,
  PdfText,
  PdfView,
} from '../../../src/runtime/components'
import {
  CONTROL_TEXT,
  DECORATED_TEXT,
  INHERIT_TEXT,
  controlTextStyle,
  inheritPageStyle,
  inheritWrapInner,
  inheritWrapOuter,
  scenarios,
  styles,
  styleValueCases,
  textValueCases,
  unitLengthCases,
  type PdfSize,
  type PdfStyle,
  type PdfStyleValue,
} from './styles-data'

type Child = VNode | VNode[]

// A tagged View mirroring the React `box` helper. `id` survives into the
// resolved layout node so the test locates its box by id.
const box = (id: string, style: PdfStyleValue, children?: () => Child) =>
  h(PdfView, { key: id, id, style }, children ? { default: children } : undefined)

const scenarioBody = (id: string): Child => {
  switch (id) {
    case 'flex-row-grow':
      return h(PdfView, { style: styles.rowGrow }, { default: () => [
        box('rowGrowA', styles.rowGrowA),
        box('rowGrowB', styles.rowGrowB),
        box('rowGrowC', styles.rowGrowC),
      ] })
    case 'flex-column':
      return h(PdfView, { style: styles.col }, { default: () => [
        box('colA', styles.colA),
        box('colB', styles.colB),
        box('colC', styles.colC),
      ] })
    case 'flex-basis-shrink':
      return h(PdfView, { style: styles.basisRow }, { default: () => [
        box('basisA', styles.basisChild),
        box('basisB', styles.basisChild),
      ] })
    case 'flex-align-justify':
      return h(PdfView, { style: styles.alignRow }, { default: () => [
        box('alignA', styles.alignChild),
        box('alignB', styles.alignChild),
        box('alignC', styles.alignChild),
      ] })
    case 'flex-gap':
      return h(PdfView, { style: styles.gapRow }, { default: () => [
        box('gapA', styles.gapChild),
        box('gapB', styles.gapChild),
        box('gapC', styles.gapChild),
      ] })
    case 'auto-layout-values':
      return [
        box('autoMarginParent', styles.autoMarginParent, () =>
          box('autoMarginChild', styles.autoMarginChild)),
        box('autoBasisRow', styles.autoBasisRow, () => [
          box('autoBasisChild', styles.autoBasisChild),
          box('autoBasisSibling', styles.autoBasisSibling),
        ]),
      ]
    case 'length-units':
      return unitLengthCases.map(({ id: unitId, style }) => box(unitId, style))
    case 'style-values':
      return [
        ...styleValueCases.map(({ id: valueId, style }) => box(valueId, style)),
        ...textValueCases.map(({ id: valueId, source, style }) => h(PdfText, {
          key: valueId,
          id: valueId,
          style,
        }, () => source)),
      ]
    case 'percent':
      return box('pctOuter', styles.pctOuter, () => box('pctInner', styles.pctInner))
    case 'margin-padding-border':
      return box('mpbBox', styles.mpbBox)
    case 'dimension-constraints':
      return [
        box('minWidthBox', styles.minWidthBox),
        box('maxHeightBox', styles.maxHeightBox),
      ]
    case 'style-array-falsy':
      return box('arrBox', styles.arrView)
    case 'style-object-control':
      return box('objBox', styles.arrControl)
    case 'inherited-props':
      return box('inhOuter', inheritWrapOuter, () =>
        box('inhInner', inheritWrapInner, () => [
          h(PdfText, { key: 'inh', id: 'inhText' }, () => INHERIT_TEXT),
          h(PdfText, { key: 'ctl', id: 'ctlText', style: controlTextStyle }, () => CONTROL_TEXT),
        ]))
    case 'border':
      return box('borderBox', styles.borderBox)
    case 'closed-style-paint':
      return [
        box('styledBorderBox', styles.styledBorderBox),
        box('styledEdgesBox', styles.styledEdgesBox),
        box('cornerRadiiBox', styles.cornerRadiiBox),
        h(PdfText, {
          key: 'decoratedText',
          id: 'decoratedText',
          style: styles.decoratedText,
        }, () => DECORATED_TEXT),
      ]
    case 'background-opacity':
      return [
        box('opaqueBox', styles.opaqueBox),
        box('opacityBox', styles.opacityBox),
      ]
    case 'transform':
      return box('transformBox', styles.transformBox)
    default:
      throw new Error(`Unknown scenario: ${id}`)
  }
}

const pageStyle = (id: string): PdfStyle =>
  id === 'inherited-props' ? inheritPageStyle : styles.page

const vuePage = (id: string, size: PdfSize) =>
  h(PdfPage, { key: id, size, style: pageStyle(id) }, { default: () => scenarioBody(id) })

/** Full corpus: one Page per scenario, in `scenarios` order. */
export const VueStylesDocument = defineComponent({
  name: 'VueStylesDocument',
  setup() {
    return () => h(PdfDocument, { title: 'Nuxt PDF style/layout corpus' }, {
      default: () => scenarios.map(s => vuePage(s.id, s.size)),
    })
  },
})

/** A single scenario isolated on its own one-page document (for rasters). */
export const VueStyleScenario = defineComponent({
  name: 'VueStyleScenario',
  props: {
    scenario: { type: String, required: true },
  },
  setup(props) {
    return () => {
      const scenario = scenarios.find(s => s.id === props.scenario)
      if (!scenario) throw new Error(`Unknown scenario: ${props.scenario}`)
      return h(PdfDocument, { title: `Nuxt PDF style scenario: ${props.scenario}` }, {
        default: () => vuePage(scenario.id, scenario.size),
      })
    }
  },
})
