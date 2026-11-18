// Presentation models for the annual report. Each builder turns typed data
// into the plain numbers and strings the SFC template binds directly — SVG
// geometry, table cell text, tile deltas — so the .vue file stays declarative
// and this logic can be unit-reasoned on its own. No Vue, no side effects.

import type { PdfSvgTransform } from '@lupinum/nuxt-pdf'
import type {
  LedgerRow,
  MonthlyPoint,
  QuarterRevenue,
  RevenueSector,
  YearFigures,
} from '../../../shared/annual'
import {
  buildLedger,
  fmtMoneyShort,
  fmtPercent,
  fmtThousands,
} from '../../../shared/annual'
import { accent, sectorTones } from './theme'
import { angularSpans, areaPath, donutSegment, linePoints, polar, yScale } from './geometry'

// --- Grouped bar chart -----------------------------------------------------

export interface BarTick { value: number, label: string, y: number }
export interface Bar { x: number, y: number, h: number, center: number, value: number, fill: string, labelTop: number }
export interface BarGroup { label: string, center: number }
export interface BarModel {
  width: number
  height: number
  gutter: number
  plotLeft: number
  plotW: number
  baseline: number
  barW: number
  ticks: BarTick[]
  bars: Bar[]
  groups: BarGroup[]
  /** The chart in words, for assistive technology: every value it plots. */
  alt: string
}

export const barModel = (quarters: readonly QuarterRevenue[]): BarModel => {
  const width = 456
  const gutter = 30
  const plotLeft = gutter
  const plotW = width - gutter
  const baseline = 186
  const plotTop = 18
  const plotH = baseline - plotTop
  const axisMax = 600
  const barW = 30
  const innerGap = 8
  const slot = plotW / quarters.length
  const yOf = (value: number): number => baseline - (value / axisMax) * plotH

  const ticks: BarTick[] = [0, 150, 300, 450, 600].map(value => ({
    value,
    label: fmtThousands(value),
    y: yOf(value),
  }))

  const bars: Bar[] = quarters.flatMap((quarter, index) => {
    const slotStart = plotLeft + index * slot
    const firstX = slotStart + (slot - (barW * 2 + innerGap)) / 2
    return [
      { value: quarter.consulting, x: firstX, fill: accent.deep },
      { value: quarter.licensing, x: firstX + barW + innerGap, fill: accent.mid },
    ].map(bar => ({
      x: bar.x,
      y: yOf(bar.value),
      h: baseline - yOf(bar.value),
      center: bar.x + barW / 2,
      value: bar.value,
      fill: bar.fill,
      labelTop: yOf(bar.value) - 10,
    }))
  })

  const groups: BarGroup[] = quarters.map((quarter, index) => ({
    label: quarter.label,
    center: plotLeft + index * slot + slot / 2,
  }))

  const series = (name: string, pick: (quarter: QuarterRevenue) => number): string =>
    `${name}: ${quarters.map(quarter => `${quarter.label} ${fmtThousands(pick(quarter))}`).join(', ')}.`
  const alt = [
    'Grouped bar chart of revenue by quarter, in EUR thousands.',
    series('Consulting', quarter => quarter.consulting),
    series('Licensing', quarter => quarter.licensing),
  ].join(' ')

  return { width, height: baseline + 22, gutter, plotLeft, plotW, baseline, barW, ticks, bars, groups, alt }
}

// --- Line + area chart -----------------------------------------------------

export interface LineTick { value: number, y: number }
export interface LineLabelPoint { label: string, x: number, y: number }
export interface MonthTick { label: string, x: number }
export interface LineModel {
  width: number
  height: number
  gutter: number
  plotLeft: number
  plotW: number
  baseline: number
  translate: PdfSvgTransform
  area: string
  line: string
  dotX: number
  dotY: number
  ticks: LineTick[]
  months: MonthTick[]
  first: LineLabelPoint
  last: LineLabelPoint
  /** The chart in words, for assistive technology: start, end and trend. */
  alt: string
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const lineModel = (points: readonly MonthlyPoint[]): LineModel => {
  const width = 222
  const gutter = 22
  const plotLeft = gutter
  const plotW = width - gutter
  const plotTop = 14
  const baseline = 140
  const plotH = baseline - plotTop
  const axisMax = 100
  const values = points.map(point => point.mrr)
  const yOf = (value: number): number => baseline - (value / axisMax) * plotH
  const xOf = (index: number): number => plotLeft + (index / (values.length - 1)) * plotW

  const firstPoint = points[0]!
  const lastPoint = points[points.length - 1]!
  // The labels are initials (J, F, M …); twelve points are the calendar months.
  const monthName = (index: number): string =>
    points.length === MONTH_NAMES.length ? MONTH_NAMES[index]! : `month ${index + 1}`
  const rising = values.every((value, index) => index === 0 || value > values[index - 1]!)
  const alt = `Line chart of monthly recurring revenue, in EUR thousands: ${rising ? 'it rises every month, ' : ''}`
    + `from €${firstPoint.mrr}K in ${monthName(0)} to €${lastPoint.mrr}K in ${monthName(points.length - 1)}.`

  return {
    width,
    height: baseline + 18,
    gutter,
    plotLeft,
    plotW,
    baseline,
    translate: `translate(${plotLeft} ${plotTop})` as PdfSvgTransform,
    area: areaPath(values, plotW, plotH, axisMax),
    line: linePoints(values, plotW, plotH, axisMax),
    dotX: plotW,
    dotY: yScale(lastPoint.mrr, axisMax, plotH),
    ticks: [0, 50, 100].map(value => ({ value, y: yOf(value) })),
    months: points.map((point, index) => ({ label: point.label, x: xOf(index) })),
    first: { label: `€${firstPoint.mrr}K`, x: plotLeft - 2, y: yOf(firstPoint.mrr) - 11 },
    last: { label: `€${lastPoint.mrr}K`, x: width - 52, y: yOf(lastPoint.mrr) - 13 },
    alt,
  }
}

// --- Donut chart -----------------------------------------------------------

export interface DonutSegment { id: string, d: string, fill: string, transform: PdfSvgTransform }
export interface DonutLegendRow { id: string, color: string, label: string, pct: string, highlight: boolean }
export interface DonutModel {
  size: number
  total: number
  totalLabel: string
  totalK: string
  segments: DonutSegment[]
  legend: DonutLegendRow[]
  /** The chart in words, for assistive technology; the legend next to it lists every share. */
  alt: string
}

export const donutModel = (sectors: readonly RevenueSector[]): DonutModel => {
  const size = 132
  const cx = size / 2
  const cy = size / 2
  const outerR = 58
  const innerR = 35
  const explode = 6
  const total = sectors.reduce((sum, sector) => sum + sector.value, 0)
  const spans = angularSpans(sectors.map(sector => sector.value), 1.4)

  let toneIndex = 0
  const rows = sectors.map((sector, index) => {
    const { start, end } = spans[index]!
    const mid = (start + end) / 2
    const shift = sector.highlight ? polar(0, 0, explode, mid) : { x: 0, y: 0 }
    const color = sector.highlight
      ? accent.base
      : sectorTones[toneIndex++ % sectorTones.length]!
    return {
      id: sector.id,
      color,
      label: sector.label,
      highlight: sector.highlight ?? false,
      pct: fmtPercent(sector.value / total),
      d: donutSegment(cx, cy, outerR, innerR, start, end),
      transform: `translate(${shift.x.toFixed(2)} ${shift.y.toFixed(2)})` as PdfSvgTransform,
    }
  })

  const highlighted = rows.find(row => row.highlight)
  const alt = `Donut chart of the €${fmtThousands(total)}K revenue by client sector, in ${rows.length} segments`
    + `${highlighted === undefined ? '' : `; the ${highlighted.label} segment (${highlighted.pct}) is pulled out and in the accent color`}.`
    + ` Shares: ${rows.map(row => `${row.label} ${row.pct}`).join(', ')}.`

  return {
    size,
    total,
    alt,
    totalLabel: fmtMoneyShort(total),
    totalK: `€${fmtThousands(total)}K`,
    segments: rows.map(({ id, d, color, transform }) => ({ id, d, fill: color, transform })),
    legend: rows.map(({ id, color, label, pct, highlight }) => ({ id, color, label, pct, highlight })),
  }
}

// --- Ledger table ----------------------------------------------------------

export interface LedgerView {
  id: string
  label: string
  current: string
  prior: string
  /** Selects the row's classes in annual-report.vue: subtotal and total rows are ruled and bolder. */
  kind: LedgerRow['kind']
}

// Accounting convention: parenthesise outflows, plain positives otherwise.
const money = (value: number): string =>
  value < 0 ? `(${fmtThousands(Math.abs(value))})` : fmtThousands(value)

export const ledgerView = (current: YearFigures, prior: YearFigures): LedgerView[] =>
  buildLedger(current, prior).map(row => ({
    id: row.id,
    label: row.label,
    current: money(row.current),
    prior: money(row.prior),
    kind: row.kind,
  }))
