// Hyphenation by language (D41): the document's `language`
// picks the patterns of `hyphen`; each pattern file loads on first use.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient declaration must follow source imports into generated Nuxt consumer typechecks
/// <reference path="./hyphen.d.ts" />
import hyphen, { type HyphenationPatterns } from 'hyphen'
import { countWork } from '../work'

/**
 * Every pattern file of `hyphen` 1.14, by its name. One `import()` with a
 * literal path each, so bundlers keep the files apart and a render loads
 * only the language it needs (de-1996 alone is 746 KB). Not `cu` (Church
 * Slavonic): in 1.14.1 it is no valid JavaScript (an unquoted key "ⸯ"), so
 * importing it fails, and a bundler that sees the path fails the build.
 */
const PATTERN_FILES = {
  'af': () => import('hyphen/patterns/af.js'),
  'as': () => import('hyphen/patterns/as.js'),
  'be': () => import('hyphen/patterns/be.js'),
  'bg': () => import('hyphen/patterns/bg.js'),
  'bn': () => import('hyphen/patterns/bn.js'),
  'ca': () => import('hyphen/patterns/ca.js'),
  'cop': () => import('hyphen/patterns/cop.js'),
  'cs': () => import('hyphen/patterns/cs.js'),
  'cy': () => import('hyphen/patterns/cy.js'),
  'da': () => import('hyphen/patterns/da.js'),
  'de-1901': () => import('hyphen/patterns/de-1901.js'),
  'de-1996': () => import('hyphen/patterns/de-1996.js'),
  'de-ch-1901': () => import('hyphen/patterns/de-ch-1901.js'),
  'el-monoton': () => import('hyphen/patterns/el-monoton.js'),
  'el-polyton': () => import('hyphen/patterns/el-polyton.js'),
  'en-gb': () => import('hyphen/patterns/en-gb.js'),
  'en-us': () => import('hyphen/patterns/en-us.js'),
  'es': () => import('hyphen/patterns/es.js'),
  'et': () => import('hyphen/patterns/et.js'),
  'eu': () => import('hyphen/patterns/eu.js'),
  'fi': () => import('hyphen/patterns/fi.js'),
  'fi-x-school': () => import('hyphen/patterns/fi-x-school.js'),
  'fr': () => import('hyphen/patterns/fr.js'),
  'fur': () => import('hyphen/patterns/fur.js'),
  'ga': () => import('hyphen/patterns/ga.js'),
  'gl': () => import('hyphen/patterns/gl.js'),
  'grc': () => import('hyphen/patterns/grc.js'),
  'gu': () => import('hyphen/patterns/gu.js'),
  'hi': () => import('hyphen/patterns/hi.js'),
  'hr': () => import('hyphen/patterns/hr.js'),
  'hsb': () => import('hyphen/patterns/hsb.js'),
  'hu': () => import('hyphen/patterns/hu.js'),
  'hy': () => import('hyphen/patterns/hy.js'),
  'ia': () => import('hyphen/patterns/ia.js'),
  'id': () => import('hyphen/patterns/id.js'),
  'is': () => import('hyphen/patterns/is.js'),
  'it': () => import('hyphen/patterns/it.js'),
  'ka': () => import('hyphen/patterns/ka.js'),
  'kmr': () => import('hyphen/patterns/kmr.js'),
  'kn': () => import('hyphen/patterns/kn.js'),
  'la': () => import('hyphen/patterns/la.js'),
  'la-x-classic': () => import('hyphen/patterns/la-x-classic.js'),
  'la-x-liturgic': () => import('hyphen/patterns/la-x-liturgic.js'),
  'lt': () => import('hyphen/patterns/lt.js'),
  'lv': () => import('hyphen/patterns/lv.js'),
  'mk': () => import('hyphen/patterns/mk.js'),
  'ml': () => import('hyphen/patterns/ml.js'),
  'mn-cyrl': () => import('hyphen/patterns/mn-cyrl.js'),
  'mn-cyrl-x-lmc': () => import('hyphen/patterns/mn-cyrl-x-lmc.js'),
  'mr': () => import('hyphen/patterns/mr.js'),
  'mul-ethi': () => import('hyphen/patterns/mul-ethi.js'),
  'nb': () => import('hyphen/patterns/nb.js'),
  'nl': () => import('hyphen/patterns/nl.js'),
  'nn': () => import('hyphen/patterns/nn.js'),
  'no': () => import('hyphen/patterns/no.js'),
  'oc': () => import('hyphen/patterns/oc.js'),
  'or': () => import('hyphen/patterns/or.js'),
  'pa': () => import('hyphen/patterns/pa.js'),
  'pi': () => import('hyphen/patterns/pi.js'),
  'pl': () => import('hyphen/patterns/pl.js'),
  'pms': () => import('hyphen/patterns/pms.js'),
  'pt': () => import('hyphen/patterns/pt.js'),
  'rm': () => import('hyphen/patterns/rm.js'),
  'ro': () => import('hyphen/patterns/ro.js'),
  'ru': () => import('hyphen/patterns/ru.js'),
  'sa': () => import('hyphen/patterns/sa.js'),
  'sh-cyrl': () => import('hyphen/patterns/sh-cyrl.js'),
  'sh-latn': () => import('hyphen/patterns/sh-latn.js'),
  'sk': () => import('hyphen/patterns/sk.js'),
  'sl': () => import('hyphen/patterns/sl.js'),
  'sq': () => import('hyphen/patterns/sq.js'),
  'sr-cyrl': () => import('hyphen/patterns/sr-cyrl.js'),
  'sv': () => import('hyphen/patterns/sv.js'),
  'ta': () => import('hyphen/patterns/ta.js'),
  'te': () => import('hyphen/patterns/te.js'),
  'th': () => import('hyphen/patterns/th.js'),
  'tk': () => import('hyphen/patterns/tk.js'),
  'tr': () => import('hyphen/patterns/tr.js'),
  'uk': () => import('hyphen/patterns/uk.js'),
  'zh-latn-pinyin': () => import('hyphen/patterns/zh-latn-pinyin.js'),
} satisfies Record<string, () => Promise<{ default: HyphenationPatterns }>>

/** The name of a pattern file of `hyphen`. */
export type PatternKey = keyof typeof PATTERN_FILES

const isPatternKey = (value: unknown): value is PatternKey => typeof value === 'string' && Object.hasOwn(PATTERN_FILES, value)

/**
 * The pattern file of a language without one of its own name: the
 * spelling in use for a language with several (German 1996, monotonic
 * Greek, Cyrillic Mongolian and Serbian), US English for `en`, and the
 * Latin-script Serbo-Croatian file for Latin-script Serbian.
 */
const LANGUAGE_FILES: Readonly<Record<string, PatternKey>> = {
  'de': 'de-1996',
  'el': 'el-monoton',
  'en': 'en-us',
  'mn': 'mn-cyrl',
  'sh': 'sh-latn',
  'sr': 'sr-cyrl',
  'sr-latn': 'sh-latn',
}

/**
 * The pattern file of a BCP 47 language tag, or undefined when `hyphen` has
 * none. The longest match wins: the whole tag, then without its last subtag,
 * and so on (`de-AT` takes `de`, `en-GB` its own file, `pt-BR` `pt`).
 */
export const patternKeyOf = (language: string | undefined): PatternKey | undefined => {
  const subtags = (language ?? '').toLowerCase().replaceAll('_', '-').split('-')
  for (let length = subtags.length; length > 0; length--) {
    const tag = subtags.slice(0, length).join('-')
    if (isPatternKey(tag)) return tag
    const file = Object.hasOwn(LANGUAGE_FILES, tag) ? LANGUAGE_FILES[tag] : undefined
    if (file) return file
  }
  return undefined
}

/**
 * Languages whose writing does not hyphenate (Chinese, Japanese, Korean,
 * Arabic, Persian, Urdu, Hebrew, Yiddish): no patterns, and nothing to warn
 * about.
 */
const UNHYPHENATED_LANGUAGES = new Set(['ar', 'fa', 'he', 'ja', 'ko', 'ur', 'yi', 'zh'])

/**
 * Whether a document's language would hyphenate but `hyphen` has no
 * patterns for it: its words then break only at soft hyphens, and the
 * render warns once (`PDF_HYPHENATION_UNAVAILABLE`).
 */
export const lacksPatterns = (language: string | undefined): language is string =>
  language !== undefined && language !== '' && patternKeyOf(language) === undefined
  && !UNHYPHENATED_LANGUAGES.has(language.toLowerCase().split(/[-_]/)[0]!)

/**
 * The most words a language's cache holds. A worker serves 200 renders and an
 * in-process render lives as long as the server, so a cache keyed by the
 * words of documents needs a bound; at the bound it starts empty.
 */
export const MAX_CACHED_WORDS = 10_000

const SOFT_HYPHEN = '\u00AD'

/** The parts of a word that a line may break between, without the soft hyphens. */
export type WordParts = (word: string) => readonly string[]

/**
 * The parts of a word for a pattern file. `hyphen` caches every word it
 * splits in its closure and writes it into the exceptions of the patterns it
 * gets, so each hyphenator gets its own copy of them: the module's pattern
 * data stays as loaded, and a new hyphenator drops the old one's words.
 */
const patternParts = (patterns: HyphenationPatterns): WordParts => {
  const newHyphenator = () => hyphen([patterns[0], patterns[1], { ...patterns[2] }])
  let hyphenator = newHyphenator()
  const parts = new Map<string, readonly string[]>()
  return (word) => {
    let found = parts.get(word)
    if (!found) {
      if (parts.size >= MAX_CACHED_WORDS) {
        parts.clear()
        hyphenator = newHyphenator()
      }
      countWork('wordsHyphenated')
      found = (word.includes(SOFT_HYPHEN) ? word : hyphenator(word)).split(SOFT_HYPHEN)
      parts.set(word, found)
    }
    return found
  }
}

/** The loaded languages: one hyphenator and one word cache each, so two languages never share parts. */
const ready = new Map<PatternKey, WordParts>()
const loading = new Map<PatternKey, Promise<void>>()

/** Loads the patterns of a file once per process; a render awaits it before its layout. */
export const loadHyphenation = (key: PatternKey): Promise<void> => {
  let load = loading.get(key)
  if (!load) {
    // A failed import is not kept, so the next render tries again.
    load = PATTERN_FILES[key]().then((module) => {
      ready.set(key, patternParts(module.default))
    }, (error: unknown) => {
      loading.delete(key)
      throw error
    })
    loading.set(key, load)
  }
  return load
}

/**
 * The parts of a word for loaded patterns. The layout is synchronous, so it
 * reads what `loadHyphenation` loaded; a key it did not load is a bug of the
 * engine, not of the document.
 */
const loadedParts = (key: PatternKey): WordParts => {
  const parts = ready.get(key)
  if (!parts) throw new Error(`Hyphenation patterns "${key}" are used before they were loaded.`)
  return parts
}

/** A word split at its soft hyphens only: a document without patterns. */
const softHyphenParts: WordParts = word => word.split(SOFT_HYPHEN)

/**
 * The parts of the words of a text: none without `hyphenate` (a word is one
 * part), the soft hyphens without patterns, else the soft hyphens of a word
 * that has any and the pattern points of one that has none.
 */
export const wordPartsOf = (hyphenate: boolean, patterns: unknown): WordParts | undefined =>
  !hyphenate ? undefined : isPatternKey(patterns) ? loadedParts(patterns) : softHyphenParts
