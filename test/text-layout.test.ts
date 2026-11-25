// The text harness: rules T1 to T5
// on the lines of `layoutParagraphs`, for generated fragments. It calls the
// text layout directly, so no PDF reader and no render worker is needed.
//
//   pnpm vitest run test/text-layout.test.ts                       fixed seed, 200 texts
//   NUXT_PDF_TEXT_RUNS=5000 NUXT_PDF_TEXT_SEED=7 pnpm vitest run test/text-layout.test.ts
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import fc from 'fast-check'
import hyphen from 'hyphen'
import german from 'hyphen/patterns/de-1996.js'
import pattern from 'hyphen/patterns/en-us.js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PdfFontDataUrl } from '../src/runtime/fonts'
import { createPdfFontStore, fontStoreOf, type Font } from '../src/runtime/server/engine/fonts'
import { layoutParagraphs, loadHyphenation, measureParagraphs, type Fragment, type Line, type TextBox, type TextOptions, type TextStyle } from '../src/runtime/server/engine/text'
import { MAX_CACHED_WORDS, patternKeyOf, wordPartsOf } from '../src/runtime/server/engine/text/hyphenation'
import { missingCodePoints } from '../src/runtime/server/engine/text/itemize'
import { relabelRun } from '../src/runtime/server/engine/text/lines'
import { breakOpportunities, wrapWords } from '../src/runtime/server/engine/text/words'
import { countedWork } from '../src/runtime/server/engine/work'

// fontkit 2.0 ships no types; its own right-to-left shaping is the reference for right-to-left glyph order.
const fontkit = createRequire(import.meta.url)('fontkit') as {
  openSync: (path: string) => {
    unitsPerEm: number
    layout: (text: string, features: undefined, script: undefined, language: undefined, direction: 'rtl') => { glyphs: Array<{ id: number }>, positions: Array<{ xOffset: number }> }
  }
}

const RUNS = Number(process.env.NUXT_PDF_TEXT_RUNS) || 200
const SEED = Number(process.env.NUXT_PDF_TEXT_SEED) || 20_261_122

const FONT_FILES = {
  inter: 'playground/pdfs/fonts/Inter-400.ttf',
  lora: 'playground/pdfs/fonts/Lora-400.ttf',
  roboto: 'test/fixtures/assets/Roboto-Regular.ttf',
  cjk: 'test/fixtures/fonts/international/NotoSansCJKsc-Subset.ttf',
  arabic: 'test/fixtures/fonts/international/NotoSansArabic-Subset.ttf',
  emoji: 'test/fixtures/fonts/international/NotoEmoji-Subset.ttf',
}
type FontName = keyof typeof FONT_FILES | 'helvetica'

const fonts = {} as Record<FontName, Font>
beforeAll(async () => {
  const store = fontStoreOf(createPdfFontStore(Object.entries(FONT_FILES).map(([family, file]) => ({
    family,
    src: `data:font/ttf;base64,${readFileSync(file).toString('base64')}` as PdfFontDataUrl,
  }))))
  for (const family of [...Object.keys(FONT_FILES), 'Helvetica']) {
    await store.load({ fontFamily: family })
    fonts[family === 'Helvetica' ? 'helvetica' : family as FontName] = store.getFont({ fontFamily: family }).data!
  }
  await Promise.all([loadHyphenation('en-us'), loadHyphenation('de-1996')])
})

const STACKS: ReadonlyArray<readonly FontName[]> = [
  ['inter', 'helvetica'],
  ['lora', 'helvetica'],
  ['helvetica'],
  ['inter', 'cjk', 'helvetica'],
  ['arabic', 'helvetica'],
  ['lora', 'arabic', 'helvetica'],
  ['inter', 'emoji', 'helvetica'],
]

const style = (stack: readonly FontName[], fontSize: number, extra: Partial<TextStyle> = {}): TextStyle => ({
  fonts: stack.map(name => fonts[name]),
  fontSize,
  color: 'black',
  underline: false,
  strike: false,
  underlineColor: 'black',
  strikeColor: 'black',
  ...extra,
})

// ---------------------------------------------------------------------------
// The rules

const SOFT_HYPHEN = '­'
/** U+FFFC, the character an inline image or a leader stands for. */
const ATTACHMENT = '\uFFFC'
/** Hyphenators of their own for rule T4, built from the pattern files as loaded. */
const oracles = { 'en-us': hyphen(pattern), 'de-1996': hyphen(german) }
const isSpace = (char: string | undefined): boolean => char === ' '
/** A character that ends a paragraph (UAX #14 BK, CR, LF, NL), which a finished line does not hold. */
const isParagraphEnd = (char: string | undefined): boolean => char !== undefined && /^[\n\r\v\f\u0085\u2028\u2029]$/.test(char)
/** A character that draws nothing: it takes the last font of its stack (`pickFont`). */
const drawsNothing = (char: string): boolean => /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]$/u.test(char)

interface Input {
  /** The text without soft hyphens, as code units. */
  plain: string
  /** For each index of `plain`, the fragment it came from. */
  fragmentAt: number[]
  /** Positions in `plain` where the breaker may add a hyphen. */
  hyphenPoints: Set<number>
  /** Positions in `plain` where a line may start: the UAX #14 breaks and the hyphen points. */
  breakPoints: Set<number>
}

/** The text of the fragments with the positions where a line may break, by the documented rules. */
const inputOf = (fragments: readonly Fragment[], options: TextOptions): Input => {
  let plain = ''
  const fragmentAt: number[] = []
  fragments.forEach((fragment, index) => {
    for (const char of fragment.string) {
      if (char === SOFT_HYPHEN) continue
      for (let unit = 0; unit < char.length; unit += 1) fragmentAt.push(index)
      plain += char
    }
  })
  const raw = fragments.map(fragment => fragment.string).join('')
  const plainAt = (index: number) => [...raw.slice(0, index)].filter(char => char !== SOFT_HYPHEN).join('').length
  // UAX #14 breaks over the whole text, so a run boundary is none. The one
  // after a soft hyphen is a hyphen point instead (it adds a hyphen).
  const lineBreaks = breakOpportunities(raw).map(({ position }) => position).filter(position => raw[position - 1] !== SOFT_HYPHEN)
  const hyphenPoints = new Set<number>()
  if (options.hyphenate) {
    // Words end at spaces, line feeds, inline images and the UAX #14 breaks.
    const ends = new Set(lineBreaks)
    for (const match of raw.matchAll(/[^ \n\uFFFC]+/g)) {
      let from = match.index
      const to = match.index + match[0].length
      for (let at = from + 1; at <= to; at += 1) {
        if (at < to && !ends.has(at)) continue
        const word = raw.slice(from, at)
        const oracle = options.patterns === 'en-us' || options.patterns === 'de-1996' ? oracles[options.patterns] : undefined
        const parts = word.includes(SOFT_HYPHEN) ? word.split(SOFT_HYPHEN) : oracle ? oracle(word).split(SOFT_HYPHEN) : [word]
        let point = plainAt(from)
        for (const part of parts.slice(0, -1)) {
          point += part.length
          hyphenPoints.add(point)
        }
        from = at
      }
    }
  }
  const breakPoints = new Set([...hyphenPoints, ...lineBreaks.map(plainAt)])
  return { plain, fragmentAt, hyphenPoints, breakPoints }
}

interface Violation { rule: 'T1' | 'T2' | 'T3' | 'T4', message: string }

const isRightToLeft = (line: Line): boolean => line.runs.some(run => (run.attributes.bidiLevel ?? 0) % 2 === 1)

/** The width the glyphs of a line paint, without its leading and trailing spaces. */
const paintedWidth = (line: Line): number => line.xAdvance - line.overflowLeft - line.overflowRight

/** Checks T1 to T4 on the lines of one text. */
export const checkText = (fragments: readonly Fragment[], width: number, options: TextOptions, lines: readonly Line[]): Violation[] => {
  const input = inputOf(fragments, options)
  const found: Violation[] = []
  let at = 0
  const skipSeparators = () => {
    while (isParagraphEnd(input.plain[at]) || isSpace(input.plain[at])) at += 1
  }
  lines.forEach((line, number) => {
    const lineStart = at
    let addedHyphen = false
    /** For each code unit of a left-to-right line, the index of its character in the input. */
    const sourceOf: number[] = []
    if (isRightToLeft(line)) {
      // A right-to-left line holds its characters in visual order: compare them as a multiset.
      const take = (count: number): string[] => {
        const expected: string[] = []
        while (expected.length < count && at < input.plain.length) {
          const char = String.fromCodePoint(input.plain.codePointAt(at)!)
          if (!isSpace(char) && !isParagraphEnd(char)) expected.push(char)
          at += char.length
        }
        return expected.sort()
      }
      const chars = [...line.string].filter(char => !isSpace(char)).sort()
      let expected = take(chars.length)
      const withoutHyphen = [...chars]
      withoutHyphen.splice(chars.indexOf('-'), 1)
      if (chars.join('') !== expected.join('') && chars.includes('-')) {
        // The breaker may have added a hyphen at the logical end of the line.
        at = lineStart
        expected = take(withoutHyphen.length)
        addedHyphen = true
      }
      if ((addedHyphen ? withoutHyphen : chars).join('') !== expected.join('')) found.push({ rule: 'T1', message: `line ${number + 1} ${JSON.stringify(line.string)}: holds other characters than the text` })
    }
    else {
      const chars = [...line.string]
      for (let index = 0; index < chars.length; index += 1) {
        const char = chars[index]!
        // A paragraph end, and spaces where the line has none (collapsed at a break), are left out.
        let probe = at
        while (isParagraphEnd(input.plain[probe]) || (isSpace(input.plain[probe]) && !isSpace(char))) probe += 1
        if (input.plain.startsWith(char, probe)) {
          for (let unit = 0; unit < char.length; unit += 1) sourceOf.push(probe)
          at = probe + char.length
          continue
        }
        if (char === '-' && index === chars.length - 1) {
          addedHyphen = true
          continue
        }
        found.push({ rule: 'T1', message: `line ${number + 1} ${JSON.stringify(line.string)}: ${JSON.stringify(char)} where the text has ${JSON.stringify(input.plain.slice(at, at + 3))}` })
        return
      }
    }
    // T2: every run has a font, and holds no character its font lacks while a
    // font of the stack has it; a character no font of the stack has is in
    // the first font, which shows its .notdef glyph (D40); one that draws
    // nothing, in the last font.
    for (const run of line.runs) {
      const font = run.attributes.font?.[0]
      if (!font) {
        found.push({ rule: 'T2', message: `line ${number + 1}: run ${JSON.stringify(line.string.slice(run.start, run.end))} has no font` })
        continue
      }
      if (isRightToLeft(line)) continue
      for (const [index, char] of [...line.string.slice(run.start, run.end)].entries()) {
        const source = sourceOf[run.start + [...line.string.slice(run.start, run.start + index)].join('').length]
        if (source === undefined || char === ' ') continue
        const codePoint = char.codePointAt(0)!
        // A mark belongs to the cluster of its base; the B2b rows check where it is drawn.
        if (/\p{M}/u.test(char)) continue
        const stack = fragments[input.fragmentAt[source]!]!.style.fonts
        if (!font.hasGlyphForCodePoint(codePoint) && stack.some(candidate => candidate.hasGlyphForCodePoint(codePoint))) {
          found.push({ rule: 'T2', message: `line ${number + 1}: ${JSON.stringify(char)} drawn in a font without it, while its stack has one` })
        }
        if (char !== ATTACHMENT && !drawsNothing(char) && font !== stack[0] && !stack.some(candidate => candidate.hasGlyphForCodePoint(codePoint))) {
          found.push({ rule: 'T2', message: `line ${number + 1}: ${JSON.stringify(char)}, in no font of its stack, drawn in another font than the first` })
        }
      }
    }
    // T3: a line is no wider than its box unless it has no break opportunity inside.
    const end = input.plain.slice(0, at).trimEnd().length
    const breakable = [...input.breakPoints].some(point => point > lineStart && point < end)
    if (paintedWidth(line) > width + 1e-6 && breakable) {
      found.push({ rule: 'T3', message: `line ${number + 1} ${JSON.stringify(line.string)}: ${paintedWidth(line).toFixed(2)} pt in a ${width} pt box, with a break opportunity inside` })
    }
    // T4: an added hyphen only at a hyphen point.
    if (addedHyphen && !input.hyphenPoints.has(at)) {
      found.push({ rule: 'T4', message: `line ${number + 1} ${JSON.stringify(line.string)}: hyphen added at ${JSON.stringify(input.plain.slice(Math.max(0, at - 6), at))}|${JSON.stringify(input.plain.slice(at, at + 6))}, not a hyphen point${options.hyphenate ? '' : ' (hyphenate is false)'}` })
    }
    if (!addedHyphen) skipSeparators()
  })
  skipSeparators()
  if (at < input.plain.length) found.push({ rule: 'T1', message: `characters lost after the last line: ${JSON.stringify(input.plain.slice(at, at + 20))}` })
  return found
}

const laidOut = (fragments: readonly Fragment[], width: number, options: TextOptions): Violation[] =>
  checkText(fragments, width, options, layoutParagraphs(fragments, { x: 0, y: 0, width, height: Infinity }, options))

// ---------------------------------------------------------------------------
// The generator

const WORDS = ['wax', 'fig', 'jar', 'cup', 'oak', 'elm', 'ash', 'yew', 'hyphenation', 'extraordinary', 'responsibility', 'internationalization', 'Donaudampfschifffahrt', 'Rechnungsbetrag', 'a', 'I', '42', '3.50', 'e-mail', 'and/or']
const SOFT_WORDS = ['ex­tra­or­di­nary', 'Rech­nungs­be­trag', 'in­voice']
const CJK = [...'世中你好文日本测界語试']
const ARABIC = ['مرحبا', 'العربية']
/** Characters of the emoji font: two outside the BMP, and a heart with its emoji variation selector. */
const EMOJI = ['😀', '🚀', '❤️', 'a😀b']
/** Characters that no font of the tests has: one in the BMP, one outside it. */
const MISSING = ['ꙮ', '𝄞', 'xꙮy']
/** Bases with combining marks: a font may have the marks, only the precomposed letters (D40), or neither. */
const MARKS = ['A\u030Angstro\u0308m', 'q\u0308', 'Cafe\u0301']

const token = (stack: readonly FontName[]): fc.Arbitrary<string> => {
  const options: fc.Arbitrary<string>[] = [fc.constantFrom(...WORDS), fc.constantFrom(...SOFT_WORDS)]
  // CJK text without spaces: a line may break between any two ideographs (UAX #14).
  if (stack.includes('cjk')) options.push(fc.array(fc.constantFrom(...CJK), { minLength: 1, maxLength: 12 }).map(chars => chars.join('')))
  if (stack.includes('arabic')) options.push(fc.constantFrom(...ARABIC))
  if (stack.includes('emoji')) options.push(fc.constantFrom(...EMOJI))
  options.push(fc.constantFrom(...MISSING), fc.constantFrom(...MARKS))
  return fc.oneof(...options)
}

const fragmentArbitrary = fc.record({
  stack: fc.integer({ min: 0, max: STACKS.length - 1 }),
  fontSize: fc.constantFrom(8, 10, 12, 17.5, 24),
  align: fc.constantFrom('left', 'right', 'center', 'justify'),
  characterSpacing: fc.constantFrom(0, 0, 0, 0.5),
  underline: fc.boolean(),
  // An inline image of this width after the fragment, with no space on either side.
  imageAfter: fc.option(fc.constantFrom(8, 20, 50), { freq: 3 }),
  // The fragment's last word goes on in the next fragment, with no space between.
  joinsNext: fc.boolean(),
  seed: fc.integer(),
}).chain(({ stack, ...rest }) => fc.record({
  tokens: fc.array(token(STACKS[stack]!), { minLength: 1, maxLength: 14 }),
  separators: fc.array(fc.constantFrom(' ', ' ', ' ', '  ', '\n', ' \n'), { minLength: 14, maxLength: 14 }),
}).map(({ tokens, separators }) => ({ stack, tokens, separators, ...rest })))

type RawFragment = typeof fragmentArbitrary extends fc.Arbitrary<infer T> ? T : never

const textArbitrary = fc.record({
  fragments: fc.array(fragmentArbitrary, { minLength: 1, maxLength: 4 }),
  width: fc.constantFrom(40, 75, 120, 200, 320),
  hyphenate: fc.boolean(),
  // No language: soft hyphens only (D41).
  patterns: fc.constantFrom(undefined, 'en-us', 'de-1996'),
})

/**
 * Fragments from raw draws. A fragment that joins the next ends in the
 * middle of a word; any other but the last ends with a separator, or with an
 * inline image, which is no part of a word.
 */
const fragmentsOf = (raws: readonly RawFragment[]): Fragment[] => raws.flatMap((raw, index) => {
  const string = raw.tokens.map((word, position) => position === raw.tokens.length - 1 ? word : `${word}${raw.separators[position]}`).join('')
  const textStyle = style(STACKS[raw.stack]!, raw.fontSize, { align: raw.align, characterSpacing: raw.characterSpacing, underline: raw.underline })
  if (raw.imageAfter !== null) return [{ string, style: textStyle }, { string: ATTACHMENT, style: { ...textStyle, attachment: { width: raw.imageAfter, height: raw.fontSize, image: Buffer.alloc(0) } } }]
  return [{ string: index === raws.length - 1 || raw.joinsNext ? string : `${string}${raw.separators.at(-1)}`, style: textStyle }]
})

const describeText = (fragments: readonly Fragment[], width: number, options: TextOptions): string =>
  `width ${width}, hyphenate ${options.hyphenate}, patterns ${options.patterns}, fragments ${JSON.stringify(fragments.map(fragment => fragment.string))}`

describe('text layout rules T1 to T4', () => {
  it(`hold for ${RUNS} generated texts (seed ${SEED})`, () => {
    fc.assert(fc.property(textArbitrary, ({ fragments: raws, width, hyphenate, patterns }) => {
      const fragments = fragmentsOf(raws)
      const options: TextOptions = patterns === undefined ? { hyphenate } : { hyphenate, patterns }
      const found = laidOut(fragments, width, options)
      if (found.length > 0) throw new Error(`${describeText(fragments, width, options)}\n${found.map(violation => `${violation.rule}: ${violation.message}`).join('\n')}`)
    }), { numRuns: RUNS, seed: SEED })
    // About a millisecond a text.
  }, Math.max(5_000, RUNS * 5))

  // One row per fixed fault.
  it('T2: an emoji from the fallback font has a font (D40)', () => {
    const fragments = [{ string: 'A😀B', style: style(['inter', 'emoji', 'helvetica'], 12) }]
    expect(laidOut(fragments, 200, { hyphenate: true, patterns: 'en-us' })).toEqual([])
  })

  it('T4: a word before two spaces keeps whole with hyphenate false', () => {
    const fragments = [{ string: 'wax extraordinary  Donaudampfschifffahrt', style: style(['lora', 'helvetica'], 10) }]
    expect(laidOut(fragments, 120, { hyphenate: false })).toEqual([])
  })

  // Catches a character that shaping turns into no glyph failing a line with
  // right-to-left text ("Character 7 of a text line has no glyph"): Inter
  // has the heart, so its variation selector is a run of the emoji font,
  // which shapes it alone to no glyph.
  it('lays out a variation selector that its font shapes to no glyph beside right-to-left text', () => {
    const fragments = [{ string: 'مرحبا ', style: style(['arabic', 'helvetica'], 10) }, { string: '❤️', style: style(['inter', 'emoji', 'helvetica'], 10) }]
    expect(laidOut(fragments, 400, { hyphenate: false })).toEqual([])
  })

  it('T4: the last word of a paragraph keeps whole with hyphenate false', () => {
    const fragments = [{ string: 'oak extraordinary\nwax', style: style(['inter', 'helvetica'], 8, { align: 'justify', characterSpacing: 0.5 }) }]
    expect(laidOut(fragments, 75, { hyphenate: false })).toEqual([])
  })

  it('T3: CJK text without spaces breaks inside its box (D44)', () => {
    const fragments = [{ string: '世中你好文日本测界語试世中你好文日本测界語', style: style(['inter', 'cjk', 'helvetica'], 10) }]
    expect(laidOut(fragments, 60, { hyphenate: true, patterns: 'en-us' })).toEqual([])
  })

  it('T4: a word across runs keeps whole with hyphenate false', () => {
    const fragments = [
      { string: 'un', style: style(['inter', 'helvetica'], 12) },
      { string: 'believ', style: style(['inter', 'helvetica'], 12, { color: 'red' }) },
      { string: 'able', style: style(['inter', 'helvetica'], 12) },
    ]
    expect(laidOut(fragments, 40, { hyphenate: false })).toEqual([])
  })

  // A word across runs is hyphenated as
  // a whole, so it breaks where the same word in one run breaks. Catches
  // each run's part hyphenated on its own: the points at the run boundary
  // are lost ("unbe-" / "lievable" at 43.3 pt in 40, "Donaudampf-" at 78.4
  // pt in 60), and a part can break where the word has no point (T4).
  it.each([
    ['un|believ|able', 40, ['unbe-', 'liev-', 'able']],
    ['Donau|dampfschiff|fahrt', 60, ['Donau-', 'dampf-', 'schifffahrt']],
  ] as const)('T3, T4: %s breaks as one word with hyphenate true', (parts, width, expected) => {
    const fragments = parts.split('|').map((string, index) => ({ string, style: style(['inter', 'helvetica'], 12, index === 1 ? { color: 'red' } : {}) }))
    expect(lineStrings(fragments, width)).toEqual(expected)
    expect(laidOut(fragments, width, { hyphenate: true, patterns: 'en-us' })).toEqual([])
  })

  // An inline image is U+FFFC, class CB in UAX #14: a line may break before
  // and after it, as browsers do, and such a break adds no hyphen. A row of icons with no space between wraps (eight of 20 pt in
  // 90 pt: four a line); a word and a 50 pt image next to it part, where
  // the two would be 75 pt in 60 (before, one line of 160 pt, and "dddd"
  // with the image past the box).
  const image = (width: number) => ({ string: ATTACHMENT, style: style(['inter', 'helvetica'], 10, { attachment: { width, height: 10, image: Buffer.alloc(0) } }) })
  const lineStrings = (fragments: readonly Fragment[], width: number) => layoutParagraphs(fragments, { x: 0, y: 0, width, height: Infinity }, { hyphenate: true, patterns: 'en-us' }).map(line => line.string)

  it('breaks a row of inline images without a space between, with no hyphen', () => {
    expect(lineStrings(Array.from({ length: 8 }, () => image(20)), 90)).toEqual(['\uFFFC'.repeat(4), '\uFFFC'.repeat(4)])
  })

  it('breaks between a word and the inline image after it, with no hyphen', () => {
    const fragments = [{ string: 'cccc dddd', style: style(['inter', 'helvetica'], 10) }, image(50), { string: ' ffff', style: style(['inter', 'helvetica'], 10) }]
    expect(lineStrings(fragments, 60)).toEqual(['cccc dddd', '\uFFFC ', 'ffff'])
  })

  // A line breaks where UAX #14 allows, and only
  // there. Catches breaks at spaces only (no break after "/" or "-", at a
  // zero-width space or between ideographs; a line or paragraph separator
  // that does not end the line), and a break UAX #14 forbids: at a no-break
  // space, after a word joiner, before "!". A break after an existing hyphen
  // adds none (T4).
  it.each([
    ['after a slash', 'and/or', 20, ['and/', 'or']],
    ['after a hyphen, with no hyphen added', 'e-mail', 20, ['e-', 'mail']],
    ['at a zero-width space', 'abc\u200Bdefghi', 40, ['abc\u200B', 'defghi']],
    ['at a line separator', 'one\u2028two', 200, ['one', 'two']],
    ['at a paragraph separator', 'one\u2029two', 200, ['one', 'two']],
    ['nowhere at a no-break space', 'Nr.\u00A0123', 20, ['Nr.\u00A0123']],
    ['nowhere at a word joiner after a hyphen', 'e-\u2060mail', 20, ['e-\u2060mail']],
    ['nowhere before "!" after a space', 'mot !', 20, ['mot !']],
  ] as const)('breaks a line %s (UAX #14, D44)', (_name, string, width, expected) => {
    const fragments = [{ string, style: style(['inter', 'helvetica'], 12) }]
    expect(lineStrings(fragments, width)).toEqual(expected)
    expect(laidOut(fragments, width, { hyphenate: true, patterns: 'en-us' })).toEqual([])
  })

  // A break after a hyphen of the text, U+002D or U+2010, costs 50 (TeX's
  // \exhyphenpenalty): it is taken only when it helps. Catches it as free
  // as a break after a slash: the second line then ends "built-" and the
  // third starts "in".
  it.each(['-', '\u2010'])('breaks after the hyphen %j of the text only when that gives better lines', (hyphen) => {
    const string = 'A state-of-the-art system with built-in checks and self-made tools.'.replaceAll('-', hyphen)
    const fragments = [{ string, style: style(['inter', 'helvetica'], 10, { align: 'left' }) }]
    const laid = layoutParagraphs(fragments, { x: 0, y: 0, width: 97, height: Infinity }, { hyphenate: false })
    expect(laid.map(line => line.string.replaceAll(hyphen, '-'))).toEqual(['A state-of-the-art ', 'system with built-in ', 'checks and self-', 'made tools.'])
    expect(laidOut(fragments, 97, { hyphenate: false })).toEqual([])
  })

  it('breaks after a slash at no cost, so it takes the break that gives better lines', () => {
    // The text of the row above with slashes: the break after "built/"
    // that a hyphen's penalty of 50 avoids is free here and evens the lines.
    const fragments = [{ string: 'A state/of/the/art system with built/in checks and self/made tools.', style: style(['inter', 'helvetica'], 10, { align: 'left' }) }]
    expect(layoutParagraphs(fragments, { x: 0, y: 0, width: 97, height: Infinity }, { hyphenate: false }).map(line => line.string)).toEqual(['A state/of/the/art ', 'system with built/', 'in checks and self/', 'made tools.'])
  })

  it('keeps every glyph when a line starts with a letter whose dots the font draws apart', () => {
    // The Arabic subset draws ب as two glyphs, the second without code points; the second line starts with it.
    const fragments = [{ string: 'مرحبا بالعالم', style: style(['arabic', 'helvetica'], 12) }]
    const glyphIds = (width: number) => layoutParagraphs(fragments, { x: 0, y: 0, width, height: Infinity }, { hyphenate: true, patterns: 'en-us' })
      .flatMap(line => line.runs.flatMap(run => run.glyphs.map(glyph => glyph.id)))
      .sort((a, b) => a - b)
    expect(layoutParagraphs(fragments, { x: 0, y: 0, width: 50, height: Infinity }, { hyphenate: true, patterns: 'en-us' })).toHaveLength(2)
    expect(glyphIds(50)).toEqual(glyphIds(500))
  })

  it('draws each ligature once in a line that bidi reorders, also the same ligature twice', () => {
    // Lora draws "ffi" as one glyph for three characters; the Arabic word makes bidi reorder the whole line.
    const glyphsOf = (string: string) => layoutParagraphs([{ string, style: style(['lora', 'arabic', 'helvetica'], 12) }], { x: 0, y: 0, width: 500, height: Infinity }, { hyphenate: false })[0]!.runs[0]!.glyphs
    const mixed = glyphsOf('office office مرحبا')
    expect(mixed.filter(glyph => 'isLigature' in glyph && glyph.isLigature)).toHaveLength(2)
    expect(mixed.map(glyph => glyph.id)).toEqual(glyphsOf('office office ').map(glyph => glyph.id))
  })

  it('cuts a ligature where a hyphen breaks the word and draws each part on its line', () => {
    // Lora draws "fl" as one glyph; en-US hyphenation breaks "self-less"
    // inside it, and each part is shaped again. Catches a cut that does not
    // count where in the ligature it falls (`ligatureOffset`): the first line
    // then keeps the whole ligature ("selfl-") and the second loses it ("ess").
    const lines = layoutParagraphs([{ string: 'selfless', style: style(['lora', 'helvetica'], 12) }], { x: 0, y: 0, width: 20, height: Infinity }, { hyphenate: true, patterns: 'en-us' })
    expect(lines.map(line => String.fromCodePoint(...line.runs.flatMap(run => run.glyphs.flatMap(glyph => glyph.codePoints))))).toEqual(['self-', 'less'])
  })

  it('breaks a long paragraph of short words at the best breaks of each fitness class', () => {
    // 3,000 short words (a fixed seed), Helvetica 10 pt in 200 pt,
    // justified (ragged lines stretch at their ends, D42, so every fitness
    // class leads to the same lines there). After the first lines every line has the same width, and
    // `knuthPlass` keeps one breakpoint per fitness class there. Catches one kept breakpoint for all classes: from line 103 on,
    // 142 lines start elsewhere (lines 150, 200 and 240 start with oak, wax
    // and and).
    let state = 20_261_124
    const next = () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
      return state / 2_147_483_648
    }
    const words = ['wax', 'fig', 'jar', 'cup', 'oak', 'elm', 'ash', 'yew', 'and', 'the', 'of', 'a', 'to', 'in']
    const string = Array.from({ length: 3_000 }, () => words[Math.floor(next() * words.length)]).join(' ')
    const lines = layoutParagraphs([{ string, style: style(['helvetica'], 10, { align: 'justify' }) }], { x: 0, y: 0, width: 200, height: Infinity }, { hyphenate: true, patterns: 'en-us' })
    expect([lines.length, ...[150, 200, 240].map(index => lines[index]!.string.split(' ')[0])]).toEqual([245, 'cup', 'a', 'jar'])
  })

  it('draws the parts of a letter in a right-to-left line in the order and at the offsets of fontkit\'s right-to-left shaping', () => {
    // The Arabic subset draws ب as a letter and a dot glyph without code points: ب last, first, twice, in two words.
    const font = fontkit.openSync(FONT_FILES.arabic)
    const scale = 12 / font.unitsPerEm
    for (const string of ['حب', 'بح', 'بب', 'مرحبا بالعالم']) {
      const lines = layoutParagraphs([{ string, style: style(['arabic', 'helvetica'], 12) }], { x: 0, y: 0, width: 500, height: Infinity }, { hyphenate: false })
      const visual = font.layout(string, undefined, undefined, undefined, 'rtl')
      const runs = lines[0]!.runs
      expect(lines).toHaveLength(1)
      expect(runs.flatMap(run => run.glyphs.map(glyph => glyph.id)), string).toEqual(visual.glyphs.map(glyph => glyph.id))
      expect(runs.flatMap(run => run.positions.map(position => Math.round(position.xOffset * 1e6))), string)
        .toEqual(visual.positions.map(position => Math.round(position.xOffset * scale * 1e6)))
    }
  })

  it('runs a word of the first right-to-left block right to left, and Latin with accents left to right', () => {
    // Itemization skips the bidi algorithm when every code unit is below U+0590 (Hebrew).
    const levels = (string: string) => layoutParagraphs([{ string, style: style(['helvetica'], 12) }], { x: 0, y: 0, width: 500, height: Infinity }, { hyphenate: false })[0]!
      .runs.map(run => run.attributes.bidiLevel)
      .filter((level, index, all) => level !== all[index - 1])
    expect(levels('café שלום ÿ')).toEqual([0, 1, 0])
    expect(levels('café ÿ ʰ ͯ ӿ')).toEqual([0])
  })

  it('keeps the ellipsis after a right-to-left word that ends with a dot glyph', () => {
    // حب ends with ب, which the Arabic subset draws as a letter and a dot glyph without code points.
    const fragments = [{ string: 'حب حب حب حب', style: style(['arabic', 'helvetica'], 12) }]
    const lines = layoutParagraphs(fragments, { x: 0, y: 0, width: 40, height: Infinity, maxLines: 1, truncate: 'ellipsis' }, { hyphenate: false })
    const glyphs = lines.flatMap(line => line.runs.flatMap(run => run.glyphs))
    expect(lines).toHaveLength(1)
    expect(glyphs.filter(glyph => glyph.codePoints.includes(0x2026))).toHaveLength(1)
  })

  // Catches a glyph that carries the characters of an earlier lookup:
  // fontkit caches a glyph by id with the code points it was first asked
  // for, and every character a font lacks is glyph 0. Hyphenation asks the
  // Arabic subset (no `-`, no `…`) for a hyphen after `مرحبا` before `fig`,
  // so a later ellipsis in that font was a hyphen in the line string. A
  // font object of its own, so no earlier row decides the first lookup.
  it('keeps the ellipsis after hyphenation asked the same font for a missing hyphen', async () => {
    const store = fontStoreOf(createPdfFontStore([{ family: 'arabic', src: `data:font/ttf;base64,${readFileSync(FONT_FILES.arabic).toString('base64')}` as PdfFontDataUrl }]))
    await store.load({ fontFamily: 'arabic' })
    const arabic = { ...style(['helvetica'], 12), fonts: [store.getFont({ fontFamily: 'arabic' }).data!, fonts.helvetica] }
    layoutParagraphs([{ string: 'مرحباfig', style: arabic }], { x: 0, y: 0, width: 500, height: Infinity }, { hyphenate: true, patterns: 'en-us' })
    const [line] = layoutParagraphs([{ string: 'حب حب حب حب', style: arabic }], { x: 0, y: 0, width: 40, height: Infinity, maxLines: 1, truncate: 'ellipsis' }, { hyphenate: false })

    // In visual order the ellipsis (glyph 0, the subset has none) comes first; ب is a letter and a dot glyph.
    expect(line!.string).toBe('…بح')
    expect(line!.runs.flatMap(run => run.glyphs.map(glyph => [glyph.id, ...glyph.codePoints]))).toEqual([[0, 0x2026], [45], [9, 0x628], [17, 0x62D]])
  })
})

describe('combining marks the font lacks (D40)', () => {
  const lineOf = (string: string, family: FontName) => layoutParagraphs([{ string, style: style([family, 'helvetica'], 12) }], { x: 0, y: 0, width: 500, height: Infinity }, { hyphenate: false })[0]!
  const glyphsOf = (line: Line) => line.runs.flatMap(run => run.glyphs.map(glyph => ({ id: glyph.id, codePoints: glyph.codePoints })))

  // Catches a mark the font lacks drawn as .notdef although the font has the
  // precomposed letter (Roboto has Å and ö, not U+030A and U+0308): the glyph
  // of the letter stands for the base and its mark, so the line keeps its
  // string and offsets, and nothing is missing.
  it('draws the precomposed letter for a base and a mark the font lacks', () => {
    const line = lineOf('A\u030Angstro\u0308m', 'roboto')
    const glyphs = glyphsOf(line)

    expect(line.string).toBe('A\u030Angstro\u0308m')
    expect(glyphs.map(glyph => glyph.id)).toEqual([fonts.roboto.glyphForCodePoint(0xC5).id, ...[...'ngstr'].map(char => fonts.roboto.glyphForCodePoint(char.codePointAt(0)!).id), fonts.roboto.glyphForCodePoint(0xF6).id, fonts.roboto.glyphForCodePoint(0x6D).id])
    expect(glyphs[0]!.codePoints).toEqual([0x41, 0x30A])
    expect(glyphs[6]!.codePoints).toEqual([0x6F, 0x308])
    expect(missingCodePoints(line)).toEqual([])
  })

  // Catches a composition that swallows a mark with no precomposed form: it
  // still shows the .notdef glyph and is missing (D40).
  it('keeps a mark with no precomposed form missing', () => {
    const line = lineOf('q\u0308', 'roboto')

    expect(glyphsOf(line).map(glyph => glyph.id)).toEqual([fonts.roboto.glyphForCodePoint(0x71).id, 0])
    expect(missingCodePoints(line)).toEqual([0x308])
  })

  // Catches a mark that leaves its base for the first font of the stack:
  // the base comes from the fallback font, which draws them composed.
  it('keeps a mark with its base from a fallback font that draws them composed', () => {
    const line = layoutParagraphs([{ string: '世A\u030A', style: style(['cjk', 'roboto', 'helvetica'], 12) }], { x: 0, y: 0, width: 500, height: Infinity }, { hyphenate: false })[0]!

    expect(line.runs.map(run => run.attributes.font?.[0])).toEqual([fonts.cjk, fonts.roboto])
    expect(glyphsOf(line).at(-1)).toEqual({ id: fonts.roboto.glyphForCodePoint(0xC5).id, codePoints: [0x41, 0x30A] })
    expect(missingCodePoints(line)).toEqual([])
  })

  // Catches a composition in a font that has the marks: Lora shapes the base
  // and its mark itself, as fontkit does, so its text keeps its glyphs.
  it('keeps the decomposed shaping of a font that has the marks', () => {
    const string = 'A\u030Angstro\u0308m'
    expect(glyphsOf(lineOf(string, 'lora')).map(glyph => glyph.id)).toEqual(fonts.lora.layout(string, undefined, undefined, undefined, 'ltr').glyphs.map(glyph => glyph.id))
  })
})

describe('hyphenation patterns by language (D41)', () => {
  // Catches a language tag that misses its patterns: a region or script
  // subtag, a spelling variant, lower or upper case, or an alias.
  it.each([
    ['de', 'de-1996'], ['de-AT', 'de-1996'], ['de-CH', 'de-1996'], ['de-CH-1901', 'de-ch-1901'], ['de-1901', 'de-1901'],
    ['en', 'en-us'], ['en-US', 'en-us'], ['EN_us', 'en-us'], ['en-GB', 'en-gb'], ['pt-BR', 'pt'], ['nb-NO', 'nb'],
    ['el', 'el-monoton'], ['sr', 'sr-cyrl'], ['sr-Latn-RS', 'sh-latn'], ['mn', 'mn-cyrl'],
    ['zh', undefined], ['tlh', undefined], ['', undefined], [undefined, undefined],
  ])('finds the patterns of %j', (language, key) => {
    expect(patternKeyOf(language)).toBe(key)
  })

  // Catches a pattern file that the table misses or names wrongly (a new
  // version of hyphen, a typo in an import path): every file of the
  // installed package loads through the table by its own name, except cu,
  // which is no valid JavaScript in hyphen 1.14.1.
  it('loads every pattern file of hyphen by its name', async () => {
    const files = readdirSync('node_modules/hyphen/patterns').filter(file => file.endsWith('.js')).map(file => file.slice(0, -3))
    expect(files).toHaveLength(81)
    expect(patternKeyOf('cu')).toBeUndefined()
    for (const file of files.filter(name => name !== 'cu')) {
      const key = patternKeyOf(file)
      expect(key, file).toBe(file)
      await loadHyphenation(key!)
      expect(wrapWords({ string: 'internationalization', runs: [{ start: 0, end: 20, attributes: {} }] }, wordPartsOf(true, key)).syllables.join(''), file).toBe('internationalization')
    }
  }, 60_000)
})

describe('ragged text (D42)', () => {
  // Lora 11 pt in 150 pt. With a space's stretch as the only
  // room, a hyphen was often the only feasible break: 11 lines with 4
  // hyphens, and `hyphenationPenalty` 600 to 5,000 changed nothing.
  const PARAGRAPH = 'Nature-based solutions help cities adapt to heat and heavy rain. Green roofs, permeable streets and restored wetlands store water, cool the air and give habitat to insects and birds. Their benefits depend on careful planning, long-term maintenance and the participation of the people who live nearby.'
  const RAGGED = [
    'Nature-based solutions help ',
    'cities adapt to heat and ',
    'heavy rain. Green roofs, ',
    'permeable streets and ',
    'restored wetlands store ',
    'water, cool the air and give ',
    'habitat to insects and birds. ',
    'Their benefits depend on ',
    'careful planning, long-',
    'term maintenance and the ',
    'participation of the people ',
    'who live nearby.',
  ]
  const lines = (align: NonNullable<TextStyle['align']>, width: number, hyphenationPenalty?: number) =>
    layoutParagraphs([{ string: PARAGRAPH, style: style(['lora'], 11, { align }) }], { x: 0, y: 0, width, height: Infinity }, { hyphenate: true, patterns: 'en-us', hyphenationPenalty })
  /** The widest gap at the end of a line but the last. */
  const largestGap = (laid: readonly Line[], width: number) => Math.max(...laid.slice(0, -1).map(line => width - paintedWidth(line)))

  // Catches the stretch of the spaces as a ragged line's only room: 4 hyphens.
  // First fit without hyphens leaves 42.3 pt at 150 pt and 63.2 pt at 220 pt.
  // The break after the hyphen of "long-term" adds none (UAX #14, D44;
  // before it, the narrow lines ended "long-term maintenance " and the
  // largest gap was 38.52 pt).
  it.each(['left', 'center', 'right'] as const)('breaks %s-aligned text at even line ends without hyphens', (align) => {
    const narrow = lines(align, 150)
    expect(narrow.map(line => line.string)).toEqual(RAGGED)
    expect(largestGap(narrow, 150)).toBeCloseTo(36.01, 2)
    expect(largestGap(lines(align, 220), 220)).toBeCloseTo(42.61, 2)
  })

  // Catches a hyphen penalty that does not decide ragged breaks.
  it('lets a lower hyphenationPenalty add hyphens to ragged text', () => {
    const laid = lines('left', 150, 100)
    expect(laid.map(line => line.string)).toEqual([
      'Nature-based solutions help ',
      'cities adapt to heat and ',
      'heavy rain. Green roofs, per-',
      'meable streets and restored ',
      'wetlands store water, cool ',
      'the air and give habitat to ',
      'insects and birds. Their ben-',
      'efits depend on careful plan-',
      'ning, long-term maintenance ',
      'and the participation of the ',
      'people who live nearby.',
    ])
  })

  // Catches the line-end stretch on justified text, whose lines must keep
  // stretching their spaces (the breaks before D42).
  it('keeps the breaks of justified text', () => {
    expect(lines('justify', 150).map(line => line.string)).toEqual([
      'Nature-based solutions help ',
      'cities adapt to heat and ',
      'heavy rain. Green roofs, per-',
      'meable streets and restored ',
      'wetlands store water, cool ',
      'the air and give habitat to in-',
      'sects and birds. Their bene-',
      'fits depend on careful plan-',
      'ning, long-term maintenance ',
      'and the participation of the ',
      'people who live nearby.',
    ])
  })

  // T5: for one ragged text, a higher penalty never adds hyphens. Knuth–Plass
  // adds the square of the penalty once per hyphen to the same lines, so this
  // holds whenever it finds lines; a text with a line wider than its box falls
  // back to best fit, which is greedy, and is left out. Catches a penalty that
  // lowers the demerits of a hyphenated line, as the forced breaks' does.
  const PENALTIES = [50, 100, 600, 2000, 5000]
  const hyphensOf = (laid: readonly Line[], plain: string) =>
    laid.reduce((count, line) => count + [...line.string].filter(char => char === '-').length, 0) - [...plain].filter(char => char === '-').length
  it(`T5: a higher hyphenationPenalty adds no hyphens, for ${RUNS} generated ragged texts (seed ${SEED})`, () => {
    fc.assert(fc.property(textArbitrary, fc.integer({ min: 0, max: PENALTIES.length - 2 }), ({ fragments: raws, width, patterns }, low) => {
      const fragments = fragmentsOf(raws.map(raw => raw.align === 'justify' ? { ...raw, align: 'left' } : raw))
      const plain = fragments.map(fragment => fragment.string).join('')
      const counts = [PENALTIES[low]!, PENALTIES[low + 1]!].map((hyphenationPenalty) => {
        const laid = layoutParagraphs(fragments, { x: 0, y: 0, width, height: Infinity }, { hyphenate: true, patterns: patterns ?? 'en-us', hyphenationPenalty })
        return laid.some(line => paintedWidth(line) > width + 1e-6) ? null : hyphensOf(laid, plain)
      })
      fc.pre(counts[0] !== null && counts[1] !== null)
      if (counts[1]! > counts[0]!) throw new Error(`${describeText(fragments, width, { hyphenate: true, patterns })}: ${counts[0]} hyphens at penalty ${PENALTIES[low]}, ${counts[1]} at ${PENALTIES[low + 1]}`)
    }), { numRuns: RUNS, seed: SEED })
  }, Math.max(5_000, RUNS * 10))
})

describe('textWrap pretty (D50)', () => {
  const METHODS = 'Onset was defined as the first minute with at least three song events of a species, detected automatically and checked by ear. We modelled onset relative to civil sunrise with linear mixed models that had site as a random effect, and compared models with light, noise or both using AIC. Light and noise were standardised before fitting, so their coefficients can be compared, and their correlation across sites was low enough to fit both in one model. Values are given as means with standard errors.'
  const NATURE = 'Nature-based solutions help cities adapt to heat and heavy rain. Green roofs, permeable streets and restored wetlands store water, cool the air and give habitat to insects and birds. Their benefits depend on careful planning, long-term maintenance and the participation of the people who live nearby.'
  const lastLines = (string: string, align: NonNullable<TextStyle['align']>, width: number, textWrap?: TextStyle['textWrap']) =>
    layoutParagraphs([{ string, style: style(['lora'], 9.5, { align, textWrap }) }], { x: 0, y: 0, width, height: Infinity }, { hyphenate: true, patterns: 'en-us' })
      .slice(-2).map(line => line.string)

  // Catches 'pretty' that breaks like 'wrap': the last line is the tail of a hyphenated word.
  it('keeps the last word of a justified paragraph whole', () => {
    expect(lastLines(METHODS, 'justify', 204)).toEqual(['Values are given as means with standard er-', 'rors.'])
    expect(lastLines(METHODS, 'justify', 204, 'pretty')).toEqual(['one model. Values are given as means with ', 'standard errors.'])
  })

  // Catches the short last line left out: here no hyphen is involved.
  it('gives a ragged paragraph a last line of more than one short word', () => {
    expect(lastLines(NATURE, 'left', 194)).toEqual(['and the participation of the people who live ', 'nearby.'])
    expect(lastLines(NATURE, 'left', 194, 'pretty')).toEqual(['and the participation of the people who ', 'live nearby.'])
  })
})

describe('addresses', () => {
  const paragraph = (string: string) => ({ string, runs: [{ start: 0, end: string.length, attributes: {} }] })

  // Catches a hyphen inside an e-mail address or a URL ('hello@ex-ample.com'
  // at a line end): their words split only at soft hyphens, the other
  // words of the text as before.
  it.each([
    ['an e-mail address', 'write to hello@example.com today', ['write', ' ', 'to', ' ', 'hello@example.com', ' ', 'to', 'day']],
    ['a URL', 'see https://example.com/international', ['see', ' ', 'https://', 'example.com/', 'international']],
    ['a soft hyphen in an address', 'hello@exam\u00ADple.com', ['hello@exam', 'ple.com']],
  ])('splits %s only at soft hyphens', (_name, string, syllables) => {
    expect(wrapWords(paragraph(string), wordPartsOf(true, 'en-us')).syllables).toEqual(syllables)
  })
})

describe('the word caches', () => {
  const paragraph = (string: string) => ({ string, runs: [{ start: 0, end: string.length, attributes: {} }] })

  // Catches word caches that grow with every document a process lays out
  // (a worker serves 200 renders, an in-process render the whole server
  // life), and `hyphen` writing each word into the exceptions of the shared
  // en-us pattern data, where no new hyphenator could drop it.
  it(`keeps at most ${MAX_CACHED_WORDS} words and leaves the pattern data as loaded`, async () => {
    const english = wordPartsOf(true, 'en-us')
    const exceptions = Object.keys(pattern[2] ?? {}).length
    wrapWords(paragraph('extraordinary'), english)
    expect((await countedWork(async () => wrapWords(paragraph('extraordinary'), english))).work.wordsHyphenated).toBe(0)
    wrapWords(paragraph(Array.from({ length: MAX_CACHED_WORDS }, (_, index) => `word${index}`).join(' ')), english)
    const again = await countedWork(async () => wrapWords(paragraph('extraordinary'), english))
    expect(again.result.syllables).toEqual(['ex', 'tra', 'or', 'di', 'nary'])
    expect(again.work.wordsHyphenated).toBe(1)
    expect(Object.keys(pattern[2] ?? {})).toHaveLength(exceptions)
  })

  // Catches German hyphenated with English patterns, and two languages
  // sharing one word cache in a process, where the language a word was
  // first seen in would decide its parts in every later document (D41).
  it.each([
    ['en-us', 'Wahrscheinlichkeit', ['Wahrschein', 'lichkeit']],
    ['de-1996', 'Wahrscheinlichkeit', ['Wahr', 'schein', 'lich', 'keit']],
    ['de-1996', 'Donaudampfschifffahrtsgesellschaft', ['Do', 'nau', 'dampf', 'schiff', 'fahrts', 'ge', 'sell', 'schaft']],
    ['en-us', 'Donaudampfschifffahrtsgesellschaft', ['Donau', 'dampf', 'schiff', 'fahrts', 'ge', 'sellschaft']],
  ] as const)('splits a word with the patterns of %s: %s', (patterns, word, parts) => {
    expect(wrapWords(paragraph(word), wordPartsOf(true, patterns)).syllables).toEqual(parts)
  })

  // Catches automatic hyphenation without a language, and soft hyphens that
  // stop breaking without one (D41).
  it('splits a word only at its soft hyphens without patterns', () => {
    expect(wrapWords(paragraph('extraordinary'), wordPartsOf(true, undefined)).syllables).toEqual(['extraordinary'])
    expect(wrapWords(paragraph('extra\u00ADordinary'), wordPartsOf(true, undefined)).syllables).toEqual(['extra', 'ordinary'])
    expect(wrapWords(paragraph('extra\u00ADordinary'), wordPartsOf(false, 'en-us')).syllables).toEqual(['extraordinary'])
  })
})

/** A leader as `PdfLeader` writes it by default at 10 pt: a gap of 3 pt on each side. */
const LEADER = { style: 'dotted', width: 0.75, color: 'black', before: 3, after: 3 } as const

/** `before`, a leader and `after` in Helvetica 10, or in `stack`. */
const leadered = (before: string, after: string, extra: Partial<TextStyle> = {}, stack: readonly FontName[] = ['helvetica']): Fragment[] => [
  { string: before, style: style(stack, 10, extra) },
  { string: ATTACHMENT, style: style(stack, 10, { ...extra, leader: LEADER }) },
  { string: after, style: style(stack, 10, extra) },
]

/** The advance of each leader of a line, as it grew. */
const leaderWidths = (line: Line): number[] => line.runs.flatMap(run => run.attributes.leader
  ? run.positions.filter((_, index) => run.glyphs[index]!.codePoints.includes(0xFFFC)).map(position => round(position.xAdvance))
  : [])

const round = (value: number): number => Math.round(value * 100) / 100

describe('leaders (PdfLeader, D43)', () => {
  const lines = (fragments: readonly Fragment[], width: number, box: Partial<TextBox> = {}): Line[] =>
    layoutParagraphs(fragments, { x: 0, y: 0, width, height: Infinity, ...box }, { hyphenate: false })
  const TITLE = 'Restoring drained peatland by blocking the ditches'

  // Catches a leader that keeps its natural width (the number would follow
  // the title), and a gap given to the spaces or to an alignment instead.
  it('runs from the end of the title\'s last line to the number at the right edge', () => {
    const laid = lines(leadered(TITLE, '12'), 150)
    expect(laid.map(line => line.string)).toEqual(['Restoring drained peatland by ', `blocking the ditches${ATTACHMENT}12`])
    expect(laid.map(leaderWidths)).toEqual([[], [51.46]])
    expect(round(paintedWidth(laid[1]!))).toBe(150)
  })

  // "Introduction to peat", the gaps and "3" are 97.17 pt. In that width the
  // leader keeps its gaps; 0.01 pt less moves the last word down with the
  // leader and the number. Catches a break at the leader (a line of the
  // leader and the number alone, or the number alone).
  it('keeps its gaps when the line is full and moves the last word down with it when it is not', () => {
    const fragments = leadered('Introduction to peat', '3')
    const { maxContent } = measureParagraphs(fragments, { hyphenate: false })
    expect(round(maxContent)).toBe(97.17)
    expect(lines(fragments, maxContent).map(line => [line.string, leaderWidths(line)])).toEqual([[`Introduction to peat${ATTACHMENT}3`, [6]]])
    expect(lines(fragments, maxContent - 0.01).map(line => [line.string, leaderWidths(line)])).toEqual([['Introduction to ', []], [`peat${ATTACHMENT}3`, [72.14]]])
  })

  // A number laid out at its widest form ("88") and printed narrower ("9")
  // keeps the line's breaks (`relabelRun`, as footnote numbers are printed):
  // the leader takes the difference, and the number still ends at the
  // right edge. Catches a leader that keeps its width, so the number stops
  // short of the edge or spills past it.
  it('takes the difference when a number laid out at its widest form is printed narrower', () => {
    const laid = lines(leadered(TITLE, '88'), 150)
    const last = laid.at(-1)!
    const relabelled = relabelRun(last, last.runs.length - 1, '9')!
    expect([relabelled.string, leaderWidths(relabelled), round(paintedWidth(relabelled))]).toEqual([`blocking the ditches${ATTACHMENT}9`, [57.02], 150])
    expect(round(57.02 - leaderWidths(last)[0]!)).toBe(5.56)
  })

  // Catches leaders of one line that do not share its gap equally.
  it('shares the gap of a line equally between its leaders', () => {
    const fragments = [...leadered('A', 'B'), { string: ATTACHMENT, style: style(['helvetica'], 10, { leader: LEADER }) }, { string: 'C', style: style(['helvetica'], 10) }]
    expect(lines(fragments, 100).map(leaderWidths)).toEqual([[39.72, 39.72]])
  })

  // A leader before more text fills its own line. Each width of that line
  // costs the same (TeX's fill order), so the breaks suit the lines after
  // it: at 100 pt the price stands alone and the last line is not one word.
  // Catches a leader that leaves its line short, and a leader line that
  // asks to be full ('Trout▢ 24.50 and ' … 'wrap').
  it('fills its own line when text follows it', () => {
    const TEXT = ' 24.50 and some words that go on after the leader to wrap'
    const laid = lines(leadered('Trout', TEXT), 120)
    expect(laid.map(line => line.string)).toEqual([`Trout${ATTACHMENT} 24.50 and some `, 'words that go on after the ', 'leader to wrap'])
    expect(laid.map(line => round(paintedWidth(line)))).toEqual([120, 113.3, 63.26])
    for (const align of ['left', 'justify'] as const) {
      expect(lines(leadered('Trout', TEXT, { align }), 100).map(line => line.string)).toEqual([`Trout${ATTACHMENT} 24.50 `, 'and some words that ', 'go on after the leader ', 'to wrap'])
    }
  })

  // Catches a justified leader line (its spaces grown) and justification
  // turned off for the other lines.
  it('takes the gap of its line in justified text, whose other lines are justified', () => {
    const laid = lines(leadered('Some words that wrap onto more than one line in justified text here', '9', { align: 'justify' }), 150)
    expect(laid.map(line => round(paintedWidth(line)))).toEqual([150, 150, 150])
    expect(laid[2]!.runs.map(run => [laid[2]!.string.slice(run.start, run.end), round(run.xAdvance)])).toEqual([['here', 20.01], [ATTACHMENT, 124.43], ['9', 5.56]])
  })

  // An ellipsis ends the last line that `maxLines` keeps: before the leader
  // line, the leader is left out; on it, the leader gives up the room.
  it('gives the ellipsis room when maxLines cuts the text', () => {
    expect(lines(leadered(TITLE, '12'), 150, { maxLines: 1, truncate: 'ellipsis' }).map(line => [line.string, leaderWidths(line)])).toEqual([['Restoring drained peatland by…', []]])
    const cut = lines(leadered('Trout', ' 24.50 and some words that go on after the leader to wrap'), 120, { maxLines: 1, truncate: 'ellipsis' })
    expect(cut.map(line => [line.string, leaderWidths(line), round(paintedWidth(line))])).toEqual([[`Trout${ATTACHMENT} 24.50 and some…`, [19.37], 120]])
  })

  // In right-to-left text U+FFFC is a neutral between the title and the
  // number, so it takes the title's direction: the number at the left
  // edge, the leader, the title at the right. Catches a leader that ends up
  // beside the number or outside the two.
  it('sits between the number and the title of a right-to-left entry', () => {
    const [line] = lines(leadered('مرحبا العربية', '12', {}, ['arabic', 'helvetica']), 150)
    expect(line!.runs.map(run => [line!.string.slice(run.start, run.end), round(run.xAdvance)])).toEqual([['12', 11.44], [ATTACHMENT, 89.79], ['ةيبرعلا ابحرم', 48.77]])
  })

  // Catches an underline drawn through the leader.
  it('takes no underline of the text around it', () => {
    const [line] = lines(leadered('Intro', '3', { underline: true }), 100)
    expect(line!.decorationLines.map(({ rect }) => [round(rect.x), round(rect.width)])).toEqual([[0, 20.01], [94.44, 5.56]])
  })
})

describe('decorations', () => {
  // A Vue template that starts its text on a new line gives the text a
  // leading space. Catches the underline of a later run moved right by that
  // space: it then starts inside the link and runs under the text after it.
  it('underlines a later run at its glyphs when the line starts with a space', () => {
    const link = { string: 'link', style: style(['helvetica'], 10, { underline: true }) }
    const underlined = (before: string) => {
      const [line] = layoutParagraphs([{ string: before, style: style(['helvetica'], 10) }, link, { string: '. More', style: style(['helvetica'], 10) }], { x: 0, y: 0, width: 200, height: Infinity }, { hyphenate: false })
      const [rect] = line!.decorationLines.map(decoration => decoration.rect)
      return [round(rect!.x - line!.overflowLeft), round(rect!.width)]
    }
    expect(underlined(' at ')).toEqual(underlined('at '))
    expect(underlined('at ')).toEqual([11.12, 15])
  })

  // Catches the underline of a first run that starts with the line's
  // leading space drawn under that space: it starts at the first glyph.
  it('underlines the first run from its first glyph when the line starts with a space', () => {
    const [line] = layoutParagraphs([{ string: ' link', style: style(['helvetica'], 10, { underline: true }) }, { string: ' more', style: style(['helvetica'], 10) }], { x: 0, y: 0, width: 200, height: Infinity }, { hyphenate: false })
    expect(line!.decorationLines.map(({ rect }) => [round(rect.x), round(rect.width)])).toEqual([[2.78, 15]])
  })
})

describe('spaces at both ends of a paragraph', () => {
  const helvetica = (string: string): Fragment[] => [{ string, style: style(['helvetica'], 10) }]

  // A Vue template that puts a text's content on its own line gives it a
  // space at both ends, and a text box is as wide as its glyphs. Catches a
  // breaker that counts those spaces: the text then wraps in its own box
  // ('Fieldnote' / 'Studio'), and its content width is a space too wide.
  it('takes no room in the line breaker or the content width', () => {
    const glyphs = measureParagraphs(helvetica('Fieldnote Studio'), { hyphenate: false }).maxContent
    expect(measureParagraphs(helvetica(' Fieldnote Studio '), { hyphenate: false }).maxContent).toBe(glyphs)
    const laid = layoutParagraphs(helvetica(' Fieldnote Studio '), { x: 0, y: 0, width: glyphs, height: Infinity }, { hyphenate: false })
    expect(laid.map(line => line.string)).toEqual([' Fieldnote Studio '])
  })
})

describe('content widths (measureParagraphs)', () => {
  const lines = (fragments: readonly Fragment[], width: number, options: TextOptions): Line[] =>
    layoutParagraphs(fragments, { x: 0, y: 0, width, height: Infinity }, options)
  const widest = (laid: readonly Line[]): number => Math.max(...laid.map(paintedWidth))

  const TEXTS: ReadonlyArray<[name: string, fragments: () => Fragment[], options: TextOptions, paragraphs: number]> = [
    ['one font, whole words', () => [{ string: 'wax extraordinary oak', style: style(['inter', 'helvetica'], 12) }], { hyphenate: false }, 1],
    ['one font, syllables', () => [{ string: 'wax extraordinary oak', style: style(['inter', 'helvetica'], 12) }], { hyphenate: true, patterns: 'en-us' }, 1],
    ['two paragraphs, two fonts, letter spacing', () => [
      { string: 'oak tree\nmuch longer paragraph ', style: style(['lora', 'helvetica'], 10) },
      { string: 'tail', style: style(['inter', 'helvetica'], 10, { characterSpacing: 1 }) },
    ], { hyphenate: true, patterns: 'en-us' }, 2],
    ['Arabic', () => [{ string: 'مرحبا العربية', style: style(['arabic', 'helvetica'], 12) }], { hyphenate: false }, 1],
    ['a leader joined to the word before and the text after', () => leadered('wax extraordinary', '24 oak'), { hyphenate: false }, 1],
    ['CJK text without spaces, an ideograph a piece', () => [{ string: '世中你好文日本测界語', style: style(['inter', 'cjk', 'helvetica'], 10) }], { hyphenate: false }, 1],
  ]

  it.each(TEXTS)('%s: no line overflows at minContent, a line per paragraph at maxContent', (_name, text, options, paragraphs) => {
    const fragments = text()
    const { maxContent, minContent } = measureParagraphs(fragments, options)
    expect(lines(fragments, maxContent, options)).toHaveLength(paragraphs)
    expect(widest(lines(fragments, minContent, options))).toBeLessThanOrEqual(minContent + 1e-6)
    // Neither width has room to spare: one point less breaks a paragraph
    // again, or leaves a piece wider than its line.
    expect(lines(fragments, maxContent - 1, options).length).toBeGreaterThan(paragraphs)
    const narrow = lines(fragments, minContent - 1, options)
    expect(widest(narrow)).toBeGreaterThan(minContent - 1)
  })

  it('measures whole words without hyphenation and syllables with it', () => {
    const fragments = [{ string: 'wax extraordinary oak', style: style(['helvetica'], 10) }]
    // Helvetica at 10 pt, with its kerning: "extraordinary" is 58.25 pt; with
    // hyphenation the widest piece is "nary" before its space, 19.75 pt.
    expect(measureParagraphs(fragments, { hyphenate: false })).toEqual({ maxContent: expect.closeTo(97.56, 6), minContent: expect.closeTo(58.25, 6) })
    expect(measureParagraphs(fragments, { hyphenate: true, patterns: 'en-us' })).toEqual({ maxContent: expect.closeTo(97.56, 6), minContent: expect.closeTo(19.75, 6) })
  })

  // "extraordinary" (58.25 pt), the leader's gaps (6 pt) and "24" (11.12
  // pt) are one piece. Catches a leader counted as a piece of its own.
  it('measures the word before a leader, its gaps and the text after it as one piece', () => {
    expect(measureParagraphs(leadered('wax extraordinary', '24 oak'), { hyphenate: false })).toEqual({ maxContent: expect.closeTo(114.68, 6), minContent: expect.closeTo(75.37, 6) })
  })

  it('counts the hyphen of a break inside a word', () => {
    // "re-spon-si-bil-i-ty": the widest piece is "spon", 21.68 pt, inside the
    // word, so a line that holds it breaks after it and adds a 4 pt hyphen.
    const fragments = [{ string: 'responsibility', style: style(['helvetica'], 10) }]
    expect(measureParagraphs(fragments, { hyphenate: true, patterns: 'en-us' })).toEqual({ maxContent: expect.closeTo(57.79, 6), minContent: expect.closeTo(25.68, 6) })
  })
})

describe('line breaking: one paragraph for each cost term that decides', () => {
  // Each paragraph breaks differently without its term of the Knuth–Plass
  // cost (text/break.ts); found against the copy's breaker with the term
  // left out, then shrunk. The demerit of two hyphenated lines in a row
  // decided no line in 160,000 generated texts, so it has no row.
  // The ragged line-end stretch (D42) makes every ragged paragraph feasible
  // at tolerance 4, so the tolerance steps decide only justified text.
  it.each<[term: string, align: 'left' | 'justify', width: number, text: string, lines: string[]]>([
    ['the fitness demerit (a loose line after a tight one)', 'left', 263, 'internationalization wax ash fig extraordinary ash oak and/or ash a hyphenation jar paragraph hyphenation', [
      'internationalization wax ash fig extraordinary ash ',
      'oak and/or ash a hyphenation jar paragraph ',
      'hyphenation',
    ]],
    ['the tolerance steps (none at 4, the first at 9)', 'justify', 123, 'paragraph extraordinary', [
      'paragraph extraordi-',
      'nary',
    ]],
  ])('%s', (_term, align, width, text, lines) => {
    const laid = layoutParagraphs([{ string: text, style: style(['helvetica'], 12, { align }) }], { x: 0, y: 0, width, height: Infinity }, { hyphenate: true, patterns: 'en-us' })
    expect(laid.map(line => line.string)).toEqual(lines)
  })
})

describe('anchors of nested texts', () => {
  const anchor = { id: 'table' }
  const fragments = (): Fragment[] => [
    { string: 'See the ', style: style(['inter', 'helvetica'], 12) },
    { string: 'summary table', style: style(['inter', 'helvetica'], 12, { anchors: [anchor] }) },
    { string: ' below.', style: style(['inter', 'helvetica'], 12) },
  ]

  /** The text from where the first run with anchors starts, in reading order, and its anchors. */
  const firstAnchored = (laid: readonly Line[]) => {
    for (const [number, line] of laid.entries()) {
      const run = line.runs.find(candidate => candidate.attributes.anchors)
      if (run) return { line: number + 1, from: line.string.slice(run.start), anchors: run.attributes.anchors }
    }
    return undefined
  }

  it.each([[400, 1], [70, 2]])('stay on the first glyph of their text in a %s pt line', (width, line) => {
    const laid = layoutParagraphs(fragments(), { x: 0, y: 0, width, height: Infinity }, { hyphenate: false })
    expect(firstAnchored(laid)).toEqual({ line, from: expect.stringMatching(/^summary/), anchors: [anchor] })
  })
})

describe('raised and lowered runs (verticalAlign)', () => {
  // 'CO' at 15 pt and a struck '2' at 9 pt; fragments.ts shifts a sub by a
  // fifth of the parent's 15 pt (-3) and a super by a third (+5).
  const line = (baselineShift: number, lineHeight?: number): Line => layoutParagraphs([
    { string: 'CO', style: style(['inter'], 15, { lineHeight }) },
    { string: '2', style: style(['inter'], 9, { baselineShift, lineHeight, strike: true }) },
  ], { x: 0, y: 0, width: 500, height: Infinity }, { hyphenate: false })[0]!
  const sizes = (laid: Line) => ({
    ascent: Number(laid.ascent!.toFixed(2)),
    height: Number(laid.box!.height.toFixed(2)),
    strike: Number(laid.decorationLines[0]!.rect.y.toFixed(2)),
  })

  // Inter at 15 pt: ascent 14.53, descent -3.62, no line gap; the 9 pt '2' reaches 8.72 up, 2.17 down.
  it('grows the line only where the shifted run leaves the line, and strikes the run at its own baseline', () => {
    expect(sizes(line(0))).toEqual({ ascent: 14.53, height: 18.15, strike: 11.63 })
    // 8.72 + 5 stays below 14.53: the line keeps its sizes, the strike moves up 5.
    expect(sizes(line(5))).toEqual({ ascent: 14.53, height: 18.15, strike: 6.63 })
    // 8.72 + 8 = 16.72 raises the baseline; the box holds it and the 3.62 below.
    expect(sizes(line(8))).toEqual({ ascent: 16.72, height: 20.34, strike: 5.81 })
    // -2.17 - 3 = -5.17 reaches below -3.62: 14.53 + 5.17.
    expect(sizes(line(-3))).toEqual({ ascent: 14.53, height: 19.7, strike: 14.63 })
    // A line height of 24 already holds it. Each run puts half of what 24
    // adds to its glyph box above it (half-leading): 14.53 + 2.93 for 'CO'
    // is the baseline, so the strike moves down by 2.93.
    expect(sizes(line(-3, 24))).toEqual({ ascent: 14.53, height: 24, strike: 17.55 })
  })

  it('keeps the baseline of a line with a raised mark where a line without it has it', () => {
    // A line height of 1 per run: 'CO' puts 14.53 + (15 - 18.15) / 2 above
    // its baseline, the '2' raised by 5 only 8.72 + 5 + (9 - 10.89) / 2.
    // The shifted run grows the line to the glyph box of 'CO' (14.53 +
    // 3.62); half-leading from the line's own height would then put the
    // baseline at 14.53.
    const marked = layoutParagraphs([
      { string: 'CO', style: style(['inter'], 15, { lineHeight: 15 }) },
      { string: '2', style: style(['inter'], 9, { baselineShift: 5, lineHeight: 9 }) },
    ], { x: 0, y: 0, width: 500, height: Infinity }, { hyphenate: false })[0]!
    const plain = layoutParagraphs([{ string: 'CO', style: style(['inter'], 15, { lineHeight: 15 }) }], { x: 0, y: 0, width: 500, height: Infinity }, { hyphenate: false })[0]!
    expect([plain, marked].map(laid => [Number(laid.baseline.toFixed(2)), Number(laid.box!.height.toFixed(2))])).toEqual([[12.96, 15], [12.96, 18.15]])
  })
})
