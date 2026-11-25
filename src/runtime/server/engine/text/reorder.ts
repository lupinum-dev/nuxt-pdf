// Bidi reordering of a line (after textkit's `bidiReordering`): a
// line with right-to-left text gets its characters, glyphs, positions and
// runs in visual order, by the Unicode bidi algorithm's rule L2 on the
// levels that itemization gave each run.
import { NuxtPdfError, PDF_ERROR_CODES } from '../../../shared/errors'
import { bidi } from './itemize'
import type { PlacedLine } from './lines'
import type { ShapedRun } from './shape'
import type { Glyph, Position } from './types'

/** For each position of the visual order, the index of its character: each segment reversed, in order. */
const visualOrder = (length: number, segments: ReadonlyArray<readonly [number, number]>): number[] => {
  const indices = Array.from({ length }, (_, index) => index)
  for (const [start, end] of segments) {
    const segment = indices.slice(start, end + 1)
    for (let index = segment.length - 1; index >= 0; index -= 1) indices[end - index] = segment[index]!
  }
  return indices
}

interface Cluster { glyphs: Glyph[], positions: Position[] }

const noGlyph = (index: number) => new NuxtPdfError(PDF_ERROR_CODES.RenderError, `Character ${index} of a text line has no glyph.`)

/** The run of code unit `index` of a line. */
const runAt = (runs: readonly ShapedRun[], index: number): ShapedRun => {
  const run = runs.find(candidate => index >= candidate.start && index < candidate.end)
  if (!run) throw noGlyph(index)
  return run
}

/**
 * The glyphs of code unit `index` of a line, with their positions: the
 * character's own glyph and the glyphs without code points after it (a
 * font can draw a letter in parts, as Noto Sans Arabic draws the dot of ب),
 * up to the next character's glyph. A ligature's glyph comes with its first
 * character; the others have no glyphs. Every character of a cut line has
 * a glyph (cut.ts, `firstGlyphAt`); textkit failed with a
 * `TypeError` where it had none.
 */
const clusterAt = (run: ShapedRun, index: number): Cluster => {
  // A run that shaping turned into no glyph draws nothing: a variation
  // selector that the font before it lacks is a run of its own font, which
  // shapes it to no glyph.
  if (run.glyphs.length === 0) return { glyphs: [], positions: [] }
  const offset = index - run.start
  const first = run.stringIndices[offset]
  if (first === undefined || !run.glyphs[first] || !run.positions[first]) throw noGlyph(index)
  if (offset > 0 && run.stringIndices[offset - 1] === first) return { glyphs: [], positions: [] }
  let next = offset + 1
  while (run.stringIndices[next] === first) next += 1
  const end = run.stringIndices[next] ?? run.glyphs.length
  return { glyphs: run.glyphs.slice(first, end), positions: run.positions.slice(first, end) }
}

/**
 * A cluster in right-to-left order. Each glyph keeps the place shaping gave
 * it in the cluster: its x offset gains the advances it had before it and
 * loses the advances it has before it now. fontkit's own right-to-left
 * shaping gives the same order and offsets.
 */
const reversed = ({ glyphs, positions }: Cluster): Cluster => {
  if (glyphs.length < 2) return { glyphs, positions }
  const total = positions.reduce((sum, position) => sum + position.xAdvance, 0)
  let before = 0
  const moved = positions.map((position) => {
    const after = total - before - position.xAdvance
    const xOffset = position.xOffset + before - after
    before += position.xAdvance
    return { ...position, xOffset }
  })
  return { glyphs: glyphs.toReversed(), positions: moved.toReversed() }
}

/**
 * The line in visual order: its string, and runs that follow it. Each run
 * holds the characters of one run of the line that are next to each other
 * in visual order, with their glyphs, so a run's style, link and anchors
 * stay with its own characters: a footnote mark or a link in
 * right-to-left text draws its own glyphs, and its link area covers them. A
 * run that a reorder segment cuts becomes two or more runs. Every text is
 * left to right at paragraph level (itemize.ts), so the paragraph level is
 * 0; a line without a right-to-left run stays as it is.
 */
export const reorderLine = (line: PlacedLine): PlacedLine => {
  const levels = line.runs.flatMap(run => Array<number>(run.end - run.start).fill(run.attributes.bidiLevel ?? 0))
  const first = line.runs[0]
  const last = line.runs[line.runs.length - 1]
  const length = first && last ? last.end - first.start : 0
  const embeddingLevels = { paragraphs: [{ start: 0, end: length - 1, level: 0 }], levels }
  const segments = bidi.getReorderSegments(line.string, embeddingLevels)
  if (segments.length === 0) return line
  const runs: Array<{ source: ShapedRun, run: ShapedRun & { glyphs: Glyph[] } }> = []
  visualOrder(line.string.length, segments).forEach((index, at) => {
    const source = runAt(line.runs, index)
    const cluster = clusterAt(source, index)
    const placed = (levels[index] ?? 0) % 2 === 1 ? reversed(cluster) : cluster
    let current = runs.at(-1)
    if (current?.source !== source) {
      current = { source, run: { ...source, start: at, end: at, glyphs: [], positions: [], stringIndices: [], glyphIndices: [] } }
      runs.push(current)
    }
    const { run } = current
    run.stringIndices.push(run.glyphs.length)
    run.glyphIndices.push(...placed.glyphs.map(() => at - run.start))
    run.glyphs.push(...placed.glyphs)
    run.positions.push(...placed.positions)
    run.end = at + 1
  })
  return { box: line.box, runs: runs.map(({ run }) => run), string: bidi.getReorderedString(line.string, embeddingLevels) }
}

/**
 * For each character of a line in visual order (`reorderLine`), taken in
 * logical order, its index in the line. Rule L2 undoes itself: reordering
 * the visual string by the levels its characters carry gives the logical
 * order back. A line without a right-to-left run is in logical order.
 */
export const logicalPlaces = (line: Pick<PlacedLine, 'runs' | 'string'>): number[] => {
  const levels = line.runs.flatMap(run => Array<number>(run.end - run.start).fill(run.attributes.bidiLevel ?? 0))
  if (levels.every(level => level === 0)) return Array.from({ length: line.string.length }, (_, index) => index)
  const segments = bidi.getReorderSegments(line.string, { paragraphs: [{ start: 0, end: line.string.length - 1, level: 0 }], levels })
  return visualOrder(line.string.length, segments)
}
