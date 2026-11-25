// Composition (D40): a font that lacks a combining mark but has
// the precomposed character of its cluster draws that character, as
// HarfBuzz's normalization does. "A" + U+030A in a font without U+030A but
// with U+00C5 draws "Å" instead of "A" and the `.notdef` glyph.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient declaration must follow source imports into generated Nuxt consumer typechecks
/// <reference path="./unicode.d.ts" />
import unicode from 'unicode-properties'
import type { Font } from './types'

/** Whether a character is a combining mark (general category M): it belongs to the character before it. */
export const isCombiningMark = (codePoint: number): boolean => unicode.getCategory(codePoint).startsWith('M')

const codePointsOf = (text: string): number[] => [...text].map(character => character.codePointAt(0)!)

/**
 * The precomposed form of a cluster (a base character and the marks after
 * it) that `font` draws instead: its NFC, when the font lacks one of the
 * cluster's marks and has every character of the NFC. Undefined when the
 * font has the marks (it shapes them itself) or no composed form helps.
 */
export const composedForm = (font: Font, cluster: string): string | undefined => {
  const codePoints = codePointsOf(cluster)
  if (!codePoints.some(codePoint => isCombiningMark(codePoint) && !font.hasGlyphForCodePoint(codePoint))) return undefined
  const composed = cluster.normalize('NFC')
  if (composed === cluster || !codePointsOf(composed).every(codePoint => font.hasGlyphForCodePoint(codePoint))) return undefined
  return composed
}

/** The end of the marks that follow `index` in `text`: the end of the cluster of the character at `index`. */
export const clusterEnd = (text: string, index: number): number => {
  let end = index
  for (const character of text.slice(index)) {
    if (end > index && !isCombiningMark(character.codePointAt(0)!)) break
    end += character.length
  }
  return end
}

/** A cluster of a text that its font draws composed: its UTF-16 offsets in the text and the characters drawn. */
export interface ComposedCluster {
  start: number
  end: number
  composed: string
}

/** The clusters of `text` that `font` draws composed (`composedForm`), in text order. */
export const composedClusters = (font: Font, text: string): ComposedCluster[] => {
  const clusters: ComposedCluster[] = []
  for (let start = 0; start < text.length;) {
    const end = clusterEnd(text, start)
    const composed = end - start > 1 ? composedForm(font, text.slice(start, end)) : undefined
    if (composed !== undefined) clusters.push({ start, end, composed })
    start = end
  }
  return clusters
}
