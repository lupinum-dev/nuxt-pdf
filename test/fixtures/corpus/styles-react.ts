import React from 'react'
import { Document, Page, Text, View } from '@react-pdf/renderer'
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

const h = React.createElement

// react-pdf types its `style` prop as `Style | Style[]`; the shared data module
// keeps framework-owned styles so a single object serves both renderers. Cast
// at the React boundary via react-pdf's own inferred style type (no `any`): the
// runtime object is identical, only the compile-time view narrows.
type ReactStyle = React.ComponentProps<typeof View>['style']
const s = (style: PdfStyleValue): ReactStyle => style as ReactStyle

// A tagged View: `id` survives into the resolved layout node's props, so the
// test can locate its box regardless of tree position.
const box = (id: string, style: PdfStyleValue, ...children: React.ReactNode[]) =>
  h(View, { key: id, id, style: s(style) }, ...children)

const scenarioBody = (id: string): React.ReactNode => {
  switch (id) {
    case 'flex-row-grow':
      return h(View, { style: s(styles.rowGrow) },
        box('rowGrowA', styles.rowGrowA),
        box('rowGrowB', styles.rowGrowB),
        box('rowGrowC', styles.rowGrowC))
    case 'flex-column':
      return h(View, { style: s(styles.col) },
        box('colA', styles.colA),
        box('colB', styles.colB),
        box('colC', styles.colC))
    case 'flex-basis-shrink':
      return h(View, { style: s(styles.basisRow) },
        box('basisA', styles.basisChild),
        box('basisB', styles.basisChild))
    case 'flex-align-justify':
      return h(View, { style: s(styles.alignRow) },
        box('alignA', styles.alignChild),
        box('alignB', styles.alignChild),
        box('alignC', styles.alignChild))
    case 'flex-gap':
      return h(View, { style: s(styles.gapRow) },
        box('gapA', styles.gapChild),
        box('gapB', styles.gapChild),
        box('gapC', styles.gapChild))
    case 'auto-layout-values':
      return [
        box('autoMarginParent', styles.autoMarginParent,
          box('autoMarginChild', styles.autoMarginChild)),
        box('autoBasisRow', styles.autoBasisRow,
          box('autoBasisChild', styles.autoBasisChild),
          box('autoBasisSibling', styles.autoBasisSibling)),
      ]
    case 'length-units':
      return unitLengthCases.map(({ id: unitId, style }) => box(unitId, style))
    case 'style-values':
      return [
        ...styleValueCases.map(({ id: valueId, style }) => box(valueId, style)),
        ...textValueCases.map(({ id: valueId, source, style }) => h(Text, {
          key: valueId,
          id: valueId,
          style: s(style),
        }, source)),
      ]
    case 'percent':
      return box('pctOuter', styles.pctOuter, box('pctInner', styles.pctInner))
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
      return box('inhOuter', inheritWrapOuter,
        box('inhInner', inheritWrapInner,
          h(Text, { key: 'inh', id: 'inhText' }, INHERIT_TEXT),
          h(Text, { key: 'ctl', id: 'ctlText', style: s(controlTextStyle) }, CONTROL_TEXT)))
    case 'border':
      return box('borderBox', styles.borderBox)
    case 'closed-style-paint':
      return [
        box('styledBorderBox', styles.styledBorderBox),
        box('styledEdgesBox', styles.styledEdgesBox),
        box('cornerRadiiBox', styles.cornerRadiiBox),
        h(Text, {
          key: 'decoratedText',
          id: 'decoratedText',
          style: s(styles.decoratedText),
        }, DECORATED_TEXT),
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

const reactPage = (id: string, size: PdfSize) =>
  h(Page, { key: id, size, style: s(pageStyle(id)) }, scenarioBody(id))

/** Full corpus: one Page per scenario, in `scenarios` order. */
export const createReactStylesDocument = () =>
  h(Document, { title: 'Nuxt PDF style/layout corpus' },
    scenarios.map(scenario => reactPage(scenario.id, scenario.size)))

/** A single scenario isolated on its own one-page document (for rasters). */
export const createReactStyleScenario = (id: string) => {
  const scenario = scenarios.find(s => s.id === id)
  if (!scenario) throw new Error(`Unknown scenario: ${id}`)
  return h(Document, { title: `Nuxt PDF style scenario: ${id}` },
    reactPage(id, scenario.size))
}
