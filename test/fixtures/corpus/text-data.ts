/**
 * Shared, renderer-agnostic data for the text-behavior conformance corpus.
 *
 * Both the React fixtures (`text-react.ts`) and the Vue fixtures
 * (`text-vue.ts`) import from this single module, so any divergence in the
 * produced PDF belongs to the renderer boundary, never to the test inputs.
 *
 * Every value here is a plain data literal or a pure function. Style objects
 * are shared by reference; the hyphenation callbacks are the *same* function
 * identity on both sides, which is the only way to prove the callback wiring
 * (not just its presence) is equivalent.
 */

/** Default embedded font, registered from the Roboto TTF in every fixture. */
export const ROBOTO = 'Roboto'
/** Standard-14 font available without registration; used for font switching. */
export const HELVETICA = 'Helvetica'

/** Deterministic document metadata so info-dictionary noise never varies. */
export const textCorpusMeta = {
  title: 'Nuxt PDF text-behavior corpus',
  language: 'en',
  creationDate: new Date('2026-07-20T00:00:00.000Z'),
} as const

// ---------------------------------------------------------------------------
// (1) hyphenationCallback + (2) long-word overflow without hyphenation
// ---------------------------------------------------------------------------

/**
 * A single long token with no internal spaces. At 20pt it is far wider than
 * the 132pt column, so its wrapping is decided entirely by the hyphenation
 * callback: disabling splitting overflows one line, aggressive splitting adds
 * lines and hyphen glyphs.
 */
export const longToken = 'Supercalifragilisticexpialidocious'

/** Disable hyphenation entirely: the word is never split, so it overflows. */
export const noHyphenation = (word: string): string[] => [word]

/** Custom splitter: break every word into fixed six-character syllables. */
export const sixCharHyphenation = (word: string): string[] =>
  word.match(/.{1,6}/g) ?? [word]

export const hyphenationStyles = {
  column: { width: 132 },
  text: { fontSize: 20, marginBottom: 8 },
} as const

// ---------------------------------------------------------------------------
// (3) letterSpacing / wordSpacing effect on wrapping
// ---------------------------------------------------------------------------

/**
 * Six short words that fit on two lines at zero letterSpacing inside a 150pt
 * column. Positive letterSpacing widens every glyph advance and pushes the
 * text onto more lines. The separate wordSpacing fixture proves that the
 * deliberately unsupported no-op property is rejected at the public boundary.
 */
export const spacingText = 'alpha beta gamma delta epsilon zeta'

export const spacingStyles = {
  column: { width: 150 },
  tight: { fontSize: 12, marginBottom: 6, letterSpacing: 0 },
  wide: { fontSize: 12, marginBottom: 6, letterSpacing: 4 },
  wordSpaced: { fontSize: 12, marginBottom: 6, wordSpacing: 24 },
} as const

// ---------------------------------------------------------------------------
// (4) textAlign left / center / right / justify
// ---------------------------------------------------------------------------

/**
 * A paragraph long enough to wrap to several lines inside a fixed column, so
 * justification has interior lines to stretch and alignment has room to shift
 * line origins.
 */
export const alignParagraph
  = 'Nuxt PDF turns structured application data into a laid out document tree '
    + 'that wraps across several measured lines inside this narrow column.'

export const alignColumnWidth = 220

export const alignStyles = {
  column: { width: alignColumnWidth },
  left: { fontSize: 11, textAlign: 'left' as const, marginBottom: 10 },
  center: { fontSize: 11, textAlign: 'center' as const, marginBottom: 10 },
  right: { fontSize: 11, textAlign: 'right' as const, marginBottom: 10 },
  justify: { fontSize: 11, textAlign: 'justify' as const, marginBottom: 10 },
} as const

// ---------------------------------------------------------------------------
// (5) nested style inheritance + mixed inline font switching
// ---------------------------------------------------------------------------

/**
 * The same word rendered once in the registered Roboto and once in the
 * standard Helvetica. The two fonts have different advance widths, so a
 * genuine `fontFamily` switch produces a measurably different line width; if
 * the switch were dropped, both would measure identically.
 */
export const switchWord = 'Weight'

export const inheritanceStyles = {
  column: { width: 140 },
  roboto: { fontFamily: ROBOTO, fontSize: 24, marginBottom: 6 },
  helvetica: { fontFamily: HELVETICA, fontSize: 24, marginBottom: 6 },
  // Outer run establishes the inherited fontFamily/color/fontSize; the nested
  // run overrides only the color and must keep the inherited Helvetica + size.
  outer: {
    fontFamily: HELVETICA,
    fontSize: 24,
    color: '#1d3f72',
    marginBottom: 6,
  },
  nestedOverride: { color: '#a11' },
} as const

/** Inline segments of the inheritance line, concatenated on extraction. */
export const inheritanceSegments = {
  head: 'Base ',
  nested: 'child',
  tail: ' tail',
} as const

// ---------------------------------------------------------------------------
// (6) German umlauts + Latin-extended diacritics round-tripping
// ---------------------------------------------------------------------------

/**
 * German umlauts and eszett plus a spread of Latin-extended diacritics. Every
 * code point must survive layout and PDF text extraction byte-for-byte.
 */
export const diacriticsText
  = 'Grüße über Öl, mäßig schön; café naïve Señor Dvořák Œuvre àéîõû'

export const diacriticsStyle = { fontSize: 16 } as const

// ---------------------------------------------------------------------------
// (7) maxLines + textOverflow ellipsis truncation
// ---------------------------------------------------------------------------

/**
 * A paragraph that naturally wraps to well beyond two lines. `maxLines: 2`
 * with `textOverflow: 'ellipsis'` must truncate it to exactly two lines whose
 * final glyph is the ellipsis (U+2026).
 */
export const truncationParagraph
  = 'This paragraph is deliberately long enough to wrap onto many lines so '
    + 'that a two line clamp has something to cut and the ellipsis has a place '
    + 'to land at the end of the visible text region.'

export const truncationMaxLines = 2

/** Unicode HORIZONTAL ELLIPSIS the truncation engine appends when clamping. */
export const ELLIPSIS = '…'

export const truncationStyles = {
  column: { width: 200 },
  clamped: {
    fontSize: 11,
    maxLines: truncationMaxLines,
    textOverflow: 'ellipsis' as const,
  },
} as const
