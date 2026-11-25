// The look of every playground template, in one place: the shadcn/ui "zinc"
// colours translated to print, one blue accent, and the corner radii.
// Templates bind these in their `:root` (`--border: v-bind('theme.border')`),
// and `theme.css` holds the rules they share. Charts read them directly.

export const theme = {
  /** Body text and headings. */
  foreground: '#09090B',
  /** Captions, labels, secondary text. */
  mutedForeground: '#71717A',
  /** Card borders, row dividers, gridlines. */
  border: '#E4E4E7',
  /** Soft fills: numbered badges, neutral chart bars. */
  muted: '#F4F4F5',
  /** Background of a muted block such as the totals. */
  subtle: '#FAFAFA',
  /** Strong neutral: the dark chart series, filled controls. */
  primary: '#18181B',
  /** The one accent: status badges, positive deltas, one chart series. */
  accent: '#2563EB',
  accentSoft: '#EFF6FF',
  accentBorder: '#BFDBFE',
  /** Corner radius of cards and table wrappers. */
  radius: '10pt',
  /** Corner radius of small controls: checkboxes, numbered badges. */
  radiusSmall: '5pt',
} as const

/** Neutral greys for chart series after the accent, dark to light. */
export const chartGreys = ['#18181B', '#52525B', '#A1A1AA', '#D4D4D8', '#E4E4E7'] as const

// The genre documents (menu, certificate, e-book, article) each have their own
// look: a serif voice, a warm palette and one deep accent. The business
// documents above stay in the shadcn style.

/** Menu: warm paper, a deep forest green, fine hairlines, no radius. */
export const menuTheme = {
  paper: '#F8F4EC',
  ink: '#2B2620',
  muted: '#6E6559',
  hairline: '#DCD3C3',
  accent: '#2F4A3B',
  display: 'Cormorant',
  reading: 'Literata',
} as const

/** E-book: cream book paper, a reading serif and one rust accent. */
export const ebookTheme = {
  paper: '#F7F2E8',
  ink: '#26221D',
  muted: '#6B6256',
  hairline: '#DDD3C2',
  /** The reed stems of the cover drawing. */
  reed: '#B5AA98',
  accent: '#8C3F2B',
  display: 'Cormorant',
  reading: 'Literata',
} as const

/** Article: a journal page on light paper, serif headline, deep teal accent. */
export const articleTheme = {
  paper: '#FCFAF6',
  ink: '#1E1C19',
  muted: '#6A645A',
  hairline: '#E2DCD0',
  /** Soft fill behind code. */
  tint: '#F3EFE7',
  accent: '#1F5A5C',
  display: 'Cormorant',
  reading: 'Literata',
} as const

/**
 * Research paper: a white journal page between the shadcn documents and the
 * article. Literata for the reading text, Inter for labels, captions and
 * tables, one restrained petrol accent.
 */
export const paperTheme = {
  ink: '#1B1B1F',
  muted: '#5E5E66',
  hairline: '#D8D8DE',
  /** Gridlines of the figures. */
  grid: '#ECECF0',
  accent: '#215E78',
  /** The second data series: the rural sites. */
  secondary: '#A3A3AD',
  reading: 'Literata',
  label: 'Inter',
} as const

/** Certificate: ivory paper, one thin frame and a seal in deep ink blue. */
export const certificateTheme = {
  paper: '#FBF8F2',
  ink: '#1F1E1B',
  muted: '#6B655B',
  hairline: '#CFC6B4',
  accent: '#23395B',
  display: 'Cormorant',
  reading: 'Literata',
} as const
