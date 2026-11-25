import type { FontStore } from '../../fonts'
import { MeasureMode, type MeasureFunction } from 'yoga-layout/load'
import type { StyledNode } from '../types'
import type { ViewBox } from '../svg/props'
import { layoutText } from '../text/layout'
import { getMargin, getPadding } from './edges'

type Node = StyledNode

// yoga reads a size the function leaves out as NaN: "no size". yoga calls
// these functions with a width `Exactly` or `AtMost` (index.ts gives a node
// absolute in a row the width a column offers), and never with both sizes
// exact. The one call without a width (`Undefined`) asks a text for its
// max-content size: yoga sizes a child of a wrapping column so.

type Lines = NonNullable<Node['lines']>

// The spaces at both ends of a line lie outside its box (`overflowLeft`, `overflowRight`).
const linesWidth = (lines: Lines): number => Math.max(0, ...lines.map(line => line.xAdvance - line.overflowLeft - line.overflowRight))

const linesHeight = (lines: Lines): number => lines.reduce((sum, line) => sum + Number(line.box?.height), 0)

const ALIGNMENT_FACTORS: Record<string, number> = { center: 0.5, right: 1 }

/** What a text measured in one offered width: its lines, its box width and where its lines sit in that box. */
type Measured = { lines: Lines, width: number, alignedBoxWidth?: number, alignOffset?: number }

/** Below this, two widths in points are the same: yoga holds them in float32. */
const WIDTH_EPSILON = 0.01

/**
 * Called after yoga's layout with the content width of the text's final box:
 * the text keeps the lines it measured for that box, or is laid out in it
 * (`measureText`). Gives the height of the lines when it laid the text out,
 * as yoga's box has the height of other lines.
 */
export type SettleText = (contentWidth: number) => number | undefined

/**
 * A text measures its lines in the width yoga offers, laid out once per
 * width. In a width it may use up to (`AtMost`) the box is as wide as the
 * widest line, and the lines stay aligned in the offered width:
 * `alignOffset` moves them back. yoga can offer several widths and ask again
 * for one it asked before, so the lines of the last call are not those of
 * the final box: lines belong to the width of their box, and `settle` gives
 * the text the measure whose width the final box has (such as a text that
 * a row shrinks). yoga raises a box to its `minWidth` after the
 * measure and asks for no other width; for a box width no measure has,
 * `settle` lays the text out in the box (a `minWidth` wider than the
 * lines), and from then on the measure answers those lines, so that yoga
 * gives the box their height in one more layout (`layOutPage`). Lines this
 * function did not make are kept at any width: split parts copy their lines
 * and `alignedBoxWidth`, so each part keeps the alignment of the whole text
 * instead of measuring only its own lines (T3); a dynamic text gets none
 * until it is laid out again.
 */
export const measureText = (node: Node, fontStore: FontStore): { measure: MeasureFunction, settle: SettleText } => {
  const kept = node.lines
  // The lines per offered width: two calls at one width lay the text out once.
  const linesAt = new Map<number, Lines>()
  // The lines each layout's height cut off, by its lines.
  const hidden = new Map<Lines, number>()
  const keep = (lines: Lines) => {
    node.lines = lines
    node.hiddenLines = hidden.get(lines)
  }
  // What each call measured, one entry per mode and width.
  const measured = new Map<string, Measured>()
  let lastHeight = Number.NaN
  // The lines laid out in a final box that no measure had.
  let settledLines: Lines | undefined
  const linesIn = (width: number): Lines => {
    let lines = linesAt.get(width)
    if (!lines) {
      const laid = layoutText(node, width, lastHeight, fontStore)
      linesAt.set(width, lines = laid.lines)
      hidden.set(lines, laid.hiddenLines)
    }
    return lines
  }
  // The width of the longest line when no line wraps.
  let maxContentWidth: number | undefined
  const measure: MeasureFunction = (offeredWidth, widthMode, height) => {
    const fixed = kept ?? settledLines
    if (fixed) return { width: widthMode === MeasureMode.Exactly ? offeredWidth : Math.min(widthMode === MeasureMode.Undefined ? Infinity : offeredWidth, node.alignedBoxWidth ?? linesWidth(fixed)), height: linesHeight(fixed) }
    // Without a width the text is laid out as wide as its longest line, and
    // the height yoga offers with that call is its own guess, not a cut: a
    // cut there hid lines that the box has room for.
    const maxContent = widthMode === MeasureMode.Undefined
    const width = maxContent ? maxContentWidth ??= linesWidth(layoutText(node, Infinity, Number.NaN, fontStore).lines) : offeredWidth
    lastHeight = maxContent ? Number.NaN : height
    const lines = linesIn(width)
    // A text that wraps is as wide as the offered width, as CSS fits it
    // (max-content is wider); one that does not wrap is as wide as its widest line.
    const alignedBoxWidth = lines.some(line => !line.isLast) ? width : Math.min(width, linesWidth(lines))
    const entry: Measured = widthMode === MeasureMode.Exactly
      ? { lines, width }
      : { lines, width: alignedBoxWidth, alignedBoxWidth, alignOffset: (width - alignedBoxWidth) * (ALIGNMENT_FACTORS[String(node.style?.textAlign)] || 0) }
    measured.set(`${widthMode} ${width}`, entry)
    keep(lines)
    return { width: entry.width, height: linesHeight(lines) }
  }
  const settle: SettleText = (contentWidth) => {
    if (measured.size === 0 || settledLines) return undefined
    const closest = [...measured.values()].reduce((best, entry) => Math.abs(entry.width - contentWidth) <= Math.abs(best.width - contentWidth) ? entry : best)
    const settled: Measured = Math.abs(closest.width - contentWidth) < WIDTH_EPSILON ? closest : { lines: settledLines = linesIn(contentWidth), width: contentWidth }
    keep(settled.lines)
    node.alignedBoxWidth = settled.alignedBoxWidth
    node.alignOffset = settled.alignOffset
    return settledLines && linesHeight(settledLines)
  }
  return { measure, settle }
}

/** Room under an image on its page; above it, an image is scaled down. */
const SAFETY_HEIGHT = 10

/**
 * An image keeps its aspect ratio in the room yoga offers, and is never
 * higher than the page's content area less its own vertical margins and
 * 10 pt (no limit while the page has no box yet).
 */
export const measureImage = (page: Node, node: Node): MeasureFunction => (width, widthMode, height, heightMode) => {
  // Every image node holds its decoded image: assets/index.ts fails the
  // render when the bytes do not decode.
  const image = node.image!
  const ratio = image.width / image.height
  const margin = getMargin(node)
  const padding = getPadding(page)
  const pageArea = page.box?.height === undefined || page.box.height === null
    ? Infinity
    : page.box.height - padding.paddingTop - padding.paddingBottom - margin.marginTop - margin.marginBottom - SAFETY_HEIGHT
  if (widthMode === MeasureMode.Exactly && heightMode === MeasureMode.Undefined) {
    return { width: Number.NaN, height: Math.min(pageArea, width / ratio) }
  }
  // Room up to a width and no height (an absolute image): the width it has,
  // at its aspect ratio.
  if (widthMode === MeasureMode.AtMost && heightMode === MeasureMode.Undefined) {
    return { width, height: Math.min(pageArea, width / ratio) }
  }
  if (heightMode === MeasureMode.Exactly) {
    return { width: Math.min(height * ratio, width), height: Number.NaN }
  }
  if (widthMode === MeasureMode.Exactly && heightMode === MeasureMode.AtMost) {
    return { width: Number.NaN, height: Math.min(height, pageArea, width / ratio) }
  }
  // Room up to a width and a height.
  return ratio > 1
    ? { width, height: Math.min(width / ratio, height) }
    : { width: Math.min(height * ratio, width), height }
}

/** The aspect ratio of an SVG's view box; 1 without one. */
const aspectRatioOf = (node: Node): number => {
  // `resolveSvg` parsed the view box: an object or null (svg/props.ts).
  // Admission allows only a positive width and height.
  const viewBox = node.props.viewBox as ViewBox | null | undefined
  return viewBox ? (viewBox.maxX - viewBox.minX) / (viewBox.maxY - viewBox.minY) : 1
}

/** An SVG fills the width it gets and keeps the aspect ratio of its view box. */
export const measureSvg = (node: Node): MeasureFunction => width => ({ width, height: width / aspectRatioOf(node) })
