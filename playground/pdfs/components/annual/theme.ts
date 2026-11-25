// The chart colours of the annual report, derived from the shared theme
// (../theme.ts): neutral greys and the one accent.

import { theme } from '../theme'

export const chart = {
  /** The highlighted series: consulting bars, the recurring-revenue line, the pulled-out sector. */
  accent: theme.accent,
  /** The second bar series. */
  secondary: '#D4D4D8',
  /** Gridlines. */
  grid: theme.border,
  /** The zero line. */
  axis: '#D4D4D8',
  /** Top and bottom of the area under the line. */
  areaTop: '#BFDBFE',
  areaBottom: '#FFFFFF',
} as const

/** Grey tones for the other donut sectors, darkest (largest) first. */
export const sectorTones = ['#71717A', '#A1A1AA', '#D4D4D8', '#E4E4E7'] as const
