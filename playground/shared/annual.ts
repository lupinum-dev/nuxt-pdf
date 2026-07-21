// Typed sample data for the annual-report showcase PDF.
//
// One canonical source of truth: `YearFigures` holds the raw ledger for a
// fiscal year (all monetary values in EUR thousands). Every headline number —
// revenue, operating result, margin, KPI deltas, the donut, the bar chart, the
// ledger table — is DERIVED from these figures by the pure helpers below, so
// the whole document stays internally consistent. Quarter and sector
// breakdowns are asserted (in the test) to sum back to the yearly totals.

/** Raw ledger for one fiscal year. All money is EUR thousands. */
export interface YearFigures {
  consulting: number
  licensing: number
  personnel: number
  studio: number
  marketing: number
  administration: number
  taxRate: number
  headcount: number
  /** Days sales outstanding — an operational metric, lower is better. */
  dso: number
}

export interface QuarterRevenue {
  label: string
  consulting: number
  licensing: number
}

export interface MonthlyPoint {
  label: string
  mrr: number
}

export interface RevenueSector {
  id: string
  label: string
  value: number
  highlight?: boolean
}

export type DeltaDirection = 'up' | 'down'

export interface Kpi {
  id: string
  label: string
  value: string
  caption: string
  delta: string
  direction: DeltaDirection
  /** Whether the movement is good news — drives the accent vs. muted tone. */
  favorable: boolean
}

export interface LedgerRow {
  id: string
  label: string
  current: number
  prior: number
  /** Visual weight: a plain line item, a subtotal, or the bottom-line total. */
  kind: 'item' | 'subtotal' | 'total'
}

export interface AnnualReport {
  company: string
  form: string
  fiscalYear: number
  priorYear: number
  currency: string
  edition: string
  registration: string
  cover: {
    eyebrow: string
    title: string
    standfirst: string
  }
  letter: {
    author: string
    role: string
    place: string
    date: string
    salutation: string
    paragraphs: readonly string[]
  }
  current: YearFigures
  prior: YearFigures
  quarters: readonly QuarterRevenue[]
  monthly: readonly MonthlyPoint[]
  sectors: readonly RevenueSector[]
}

// ---------------------------------------------------------------------------
// Pure derivations. These are the only place headline figures are computed.
// ---------------------------------------------------------------------------

export const revenueOf = (y: YearFigures): number => y.consulting + y.licensing
export const opexOf = (y: YearFigures): number =>
  y.personnel + y.studio + y.marketing + y.administration
export const ebitOf = (y: YearFigures): number => revenueOf(y) - opexOf(y)
export const taxOf = (y: YearFigures): number => Math.round(ebitOf(y) * y.taxRate)
export const netOf = (y: YearFigures): number => ebitOf(y) - taxOf(y)
export const marginOf = (y: YearFigures): number => ebitOf(y) / revenueOf(y)

// ---------------------------------------------------------------------------
// Formatting. One numeric vocabulary across every chart, tile, and table cell.
// ---------------------------------------------------------------------------

const groups = new Intl.NumberFormat('en-US')

/** Thousands separator, no decimals — the ledger and axis vocabulary. */
export const fmtThousands = (value: number): string => groups.format(Math.round(value))

/** Signed thousands, used for the ledger's change column. */
export const fmtSignedThousands = (value: number): string => {
  const rounded = Math.round(value)
  if (rounded === 0) return '0'
  return `${rounded > 0 ? '+' : '−'}${groups.format(Math.abs(rounded))}`
}

/** Compact headline money, e.g. 2900 -> "€2.90M", 930 -> "€930K". */
export const fmtMoneyShort = (thousands: number): string =>
  thousands >= 1000
    ? `€${(thousands / 1000).toFixed(2)}M`
    : `€${fmtThousands(thousands)}K`

/** One-decimal percent from a 0..1 ratio. */
export const fmtPercent = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`

const pctChange = (current: number, prior: number): number =>
  (current - prior) / prior

/** Build the KPI tiles for the highlights spread, derived from both years. */
export const buildKpis = (current: YearFigures, prior: YearFigures): Kpi[] => {
  const revenueDelta = pctChange(revenueOf(current), revenueOf(prior))
  const netDelta = pctChange(netOf(current), netOf(prior))
  const marginDelta = marginOf(current) - marginOf(prior)
  const recurringDelta = pctChange(current.licensing, prior.licensing)
  const headcountDelta = current.headcount - prior.headcount
  const dsoDelta = current.dso - prior.dso

  return [
    {
      id: 'revenue',
      label: 'Total revenue',
      value: fmtMoneyShort(revenueOf(current)),
      caption: `up from ${fmtMoneyShort(revenueOf(prior))}`,
      delta: `+${(revenueDelta * 100).toFixed(1)}%`,
      direction: 'up',
      favorable: true,
    },
    {
      id: 'net',
      label: 'Net result',
      value: fmtMoneyShort(netOf(current)),
      caption: `after ${fmtPercent(current.taxRate)} tax`,
      delta: `+${(netDelta * 100).toFixed(1)}%`,
      direction: 'up',
      favorable: true,
    },
    {
      id: 'margin',
      label: 'Operating margin',
      value: fmtPercent(marginOf(current)),
      caption: `EBIT €${fmtThousands(ebitOf(current))}K`,
      delta: `+${(marginDelta * 100).toFixed(1)}pp`,
      direction: 'up',
      favorable: true,
    },
    {
      id: 'recurring',
      label: 'Recurring revenue',
      value: fmtMoneyShort(current.licensing),
      caption: `${fmtPercent(current.licensing / revenueOf(current))} of revenue`,
      delta: `+${(recurringDelta * 100).toFixed(1)}%`,
      direction: 'up',
      favorable: true,
    },
    {
      id: 'team',
      label: 'Team',
      value: `${current.headcount}`,
      caption: 'people at year-end',
      delta: `+${headcountDelta}`,
      direction: 'up',
      favorable: true,
    },
    {
      id: 'dso',
      label: 'Days to collect',
      value: `${current.dso}`,
      caption: `down from ${prior.dso} days`,
      delta: `−${Math.abs(dsoDelta)}`,
      direction: 'down',
      favorable: true,
    },
  ]
}

// ---------------------------------------------------------------------------
// The sample document.
// ---------------------------------------------------------------------------

const currentYear: YearFigures = {
  consulting: 1970,
  licensing: 930,
  personnel: 1540,
  studio: 280,
  marketing: 210,
  administration: 165,
  taxRate: 0.25,
  headcount: 18,
  dso: 38,
}

const priorYear: YearFigures = {
  consulting: 1680,
  licensing: 730,
  personnel: 1360,
  studio: 250,
  marketing: 180,
  administration: 150,
  taxRate: 0.25,
  headcount: 15,
  dso: 44,
}

export const sampleAnnualReport: AnnualReport = {
  company: 'Fieldnote Studio GmbH',
  form: 'Annual Report',
  fiscalYear: 2025,
  priorYear: 2024,
  currency: 'EUR',
  edition: 'Shareholder edition',
  registration: 'Firmenbuch FN 482913 h · Vienna',
  cover: {
    eyebrow: 'Annual Report',
    title: 'Evidence, made legible.',
    standfirst:
      'A research and reporting studio’s year in review — the numbers behind '
      + 'the field work, the systems shipped, and the partnerships that carried them.',
  },
  letter: {
    author: 'Mara Voss',
    role: 'Managing Director',
    place: 'Vienna',
    date: '18 March 2026',
    salutation: 'To our partners and shareholders,',
    paragraphs: [
      'Two thousand twenty-five was the year Fieldnote stopped being a practice '
      + 'that writes reports and became a studio that builds the systems reports '
      + 'are made from. The distinction matters. It is the difference between '
      + 'selling hours and compounding a product, and it is visible in every '
      + 'number on the pages that follow.',
      'Revenue grew to €2.90 million, a fifth higher than the year before, but the '
      + 'figure I watch most closely is the €930k now recurring from our licensed '
      + 'reporting system. Almost a third of what we earn no longer depends on the '
      + 'next engagement being signed. That is the foundation we spent three years '
      + 'quietly laying, and it is finally load-bearing.',
      'We enter 2026 with eighteen colleagues, a healthier margin, and a client '
      + 'roster spread across conservation, public infrastructure, and tourism. My '
      + 'thanks to every one of them, and to you, for reading past the cover.',
    ],
  },
  current: currentYear,
  prior: priorYear,
  quarters: [
    { label: 'Q1', consulting: 420, licensing: 180 },
    { label: 'Q2', consulting: 460, licensing: 210 },
    { label: 'Q3', consulting: 510, licensing: 240 },
    { label: 'Q4', consulting: 580, licensing: 300 },
  ],
  monthly: [
    { label: 'J', mrr: 58 },
    { label: 'F', mrr: 60 },
    { label: 'M', mrr: 61 },
    { label: 'A', mrr: 63 },
    { label: 'M', mrr: 65 },
    { label: 'J', mrr: 67 },
    { label: 'J', mrr: 70 },
    { label: 'A', mrr: 72 },
    { label: 'S', mrr: 75 },
    { label: 'O', mrr: 78 },
    { label: 'N', mrr: 81 },
    { label: 'D', mrr: 84 },
  ],
  sectors: [
    { id: 'public', label: 'Public sector', value: 1015 },
    { id: 'conservation', label: 'Conservation', value: 725, highlight: true },
    { id: 'tourism', label: 'Tourism', value: 580 },
    { id: 'infrastructure', label: 'Infrastructure', value: 435 },
    { id: 'other', label: 'Other', value: 145 },
  ],
}

/** The ledger table rows, derived from the two years' figures. */
export const buildLedger = (current: YearFigures, prior: YearFigures): LedgerRow[] => [
  { id: 'consulting', label: 'Consulting services', current: current.consulting, prior: prior.consulting, kind: 'item' },
  { id: 'licensing', label: 'Licensing & subscriptions', current: current.licensing, prior: prior.licensing, kind: 'item' },
  { id: 'revenue', label: 'Total revenue', current: revenueOf(current), prior: revenueOf(prior), kind: 'subtotal' },
  { id: 'personnel', label: 'Personnel', current: -current.personnel, prior: -prior.personnel, kind: 'item' },
  { id: 'studio', label: 'Studio & tooling', current: -current.studio, prior: -prior.studio, kind: 'item' },
  { id: 'marketing', label: 'Marketing', current: -current.marketing, prior: -prior.marketing, kind: 'item' },
  { id: 'administration', label: 'Administration', current: -current.administration, prior: -prior.administration, kind: 'item' },
  { id: 'opex', label: 'Total operating expenses', current: -opexOf(current), prior: -opexOf(prior), kind: 'subtotal' },
  { id: 'ebit', label: 'Operating result (EBIT)', current: ebitOf(current), prior: ebitOf(prior), kind: 'subtotal' },
  { id: 'tax', label: `Income tax (${fmtPercent(current.taxRate)})`, current: -taxOf(current), prior: -taxOf(prior), kind: 'item' },
  { id: 'net', label: 'Net result for the year', current: netOf(current), prior: netOf(prior), kind: 'total' },
]

/**
 * A leaner scenario — the internal board briefing. One fewer sector line (Other
 * folded into Infrastructure) and the spotlight moved to the public sector.
 * Still sums to total revenue, so every derived figure stays consistent.
 */
export const boardCutReport: AnnualReport = {
  ...sampleAnnualReport,
  edition: 'Board briefing',
  cover: {
    ...sampleAnnualReport.cover,
    eyebrow: 'Board Briefing',
  },
  sectors: [
    { id: 'public', label: 'Public sector', value: 1015, highlight: true },
    { id: 'conservation', label: 'Conservation', value: 725 },
    { id: 'tourism', label: 'Tourism', value: 580 },
    { id: 'infrastructure', label: 'Infrastructure', value: 580 },
  ],
}
