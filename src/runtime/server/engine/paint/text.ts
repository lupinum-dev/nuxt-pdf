import type { Decoration, Glyph, Line, Rect, Run } from '../text'
import { paintedGlyphs } from '../text/shape'
import type { PdfWriter, StructureElement } from '../pdf/writer'
import { contentBox, dashLengths, translate } from './box'
import { paintColor } from './color'
import { isDestination } from './links'
import type { MeasuredNode } from '../layout/types'
import type { PaintScope } from './node'

// A laid-out text: its lines, each line's runs with their backgrounds,
// links, inline images and glyphs, then the decoration lines. Ported from
// `@react-pdf/render` 4.5.1.

const renderRunBackground = (writer: PdfWriter, rect: Rect, backgroundColor: string): void => {
  const color = paintColor(backgroundColor)
  writer.save()
  writer.fillOpacity(color.alpha)
  writer.rect(rect.x, rect.y, rect.width, rect.height)
  writer.fillColor(color.rgb)
  writer.fill()
  writer.restore()
}

/**
 * Inline images sit in the run as U+FFFC glyphs: each is drawn at its place
 * (bottom-aligned on the baseline) and its glyph becomes a space in `glyphs`.
 */
const renderInlineImages = (writer: PdfWriter, run: Run, glyphs: Glyph[], scope: PaintScope): void => {
  const font = run.attributes.font?.[0]
  if (!run.positions || !font) return
  writer.save()
  const space = font.glyphForCodePoint(0x20)
  const objectReplacement = font.glyphForCodePoint(0xFFFC)
  let advance = 0
  for (let index = 0; index < glyphs.length; index += 1) {
    const position = run.positions[index]!
    advance += position.xAdvance || 0
    const attachment = run.attributes.attachment
    if (glyphs[index]!.id !== objectReplacement.id || !attachment) continue
    translate(writer, advance, position.yOffset || 0)
    const { width, height } = attachment
    translate(writer, -width, -height)
    // In a tagged leaf an inline image is its figure, or an artifact without one.
    const owner = scope.leaf === undefined ? undefined : scope.tags?.inlineImage(scope.leaf.spec, attachment.figure)
    if (owner === null) writer.beginArtifact()
    else if (owner !== undefined) writer.beginMarked(owner)
    writer.inlineImage({ data: attachment.image }, 0, 0, width, height)
    if (owner !== undefined) writer.endMarked()
    glyphs[index] = space
    advance = 0
  }
  writer.restore()
}

/**
 * Leaders sit in the run as U+FFFC glyphs, each as wide as the room its line
 * left (text/justify.ts): a line on the baseline from its start plus its
 * `before` gap to its end minus its `after` gap, and its glyph becomes a
 * space in `glyphs`, so copied text reads a space. The dash pattern starts
 * on a grid from the page's left edge, so the dots of leaders above each
 * other line up. In a tagged leaf the line is an artifact.
 */
const renderLeaders = (writer: PdfWriter, run: Run, glyphs: Glyph[], scope: PaintScope): void => {
  const font = run.attributes.font?.[0]
  const leader = run.attributes.leader
  if (!leader || !run.positions || !font) return
  const space = font.glyphForCodePoint(0x20)
  let x = 0
  for (let index = 0; index < glyphs.length; index += 1) {
    const advance = run.positions[index]!.xAdvance || 0
    if (glyphs[index]!.codePoints.includes(0xFFFC)) {
      glyphs[index] = space
      const from = x + leader.before
      const length = advance - leader.before - leader.after
      if (length > 0 && leader.width > 0) {
        const color = paintColor(leader.color)
        writer.save()
        if (scope.leaf !== undefined) writer.beginArtifact()
        writer.lineWidth(leader.width)
        writer.strokeColor(color.rgb)
        writer.strokeOpacity(color.alpha * (run.attributes.opacity ?? 1))
        const lengths = dashLengths(leader.style, leader.width)
        if (lengths) writer.dash(lengths, gridPhase(writer, from, lengths))
        // The line's lower edge is on the baseline.
        writer.moveTo(from, -leader.width / 2)
        writer.lineTo(from + length, -leader.width / 2)
        writer.stroke()
        if (scope.leaf !== undefined) writer.endMarked()
        writer.restore()
      }
    }
    x += advance
  }
}

/**
 * The dash phase that puts the pattern of a line starting at `x` on a grid
 * from the page's left edge, in user space units.
 */
const gridPhase = (writer: PdfWriter, x: number, lengths: readonly number[]): number => {
  const period = lengths.reduce((sum, length) => sum + length, 0)
  const [origin] = writer.toPage(0, 0)
  const scale = writer.toPage(1, 0)[0] - origin
  // A turned text has no horizontal grid; its pattern starts at its start.
  if (Math.abs(scale) < 1e-9) return 0
  const fromEdge = writer.toPage(x, 0)[0] / scale
  return ((fromEdge % period) + period) % period
}

const renderRun = (writer: PdfWriter, run: Run, node: MeasuredNode, scope: PaintScope): void => {
  const font = run.attributes.font?.[0]
  if (!run.glyphs || !run.positions || !font) return
  const { fontSize, link } = run.attributes
  const color = paintColor(run.attributes.color)
  const { ascent = 0, descent = 0, xAdvance = 0 } = run
  // A raised or lowered run (`verticalAlign`) moves with its link and inline images; y points down.
  const shift = run.attributes.baselineShift || 0
  if (shift !== 0) translate(writer, 0, -shift)
  // A nested text's id is a destination at the first run in reading order
  // that has it, where the nested text starts (a footnote's mark, which its
  // note's number links back to).
  for (const anchor of run.attributes.anchors ?? []) {
    if (anchor.id === undefined || scope.nestedIds.has(anchor.id)) continue
    scope.nestedIds.add(anchor.id)
    writer.destination(anchor.id, 0, -ascent)
  }
  writer.fillColor(color.rgb)
  // As in CSS, the colour's alpha and the opacity multiply.
  writer.fillOpacity(color.alpha * (run.attributes.opacity ?? 1))
  // In a tagged leaf an inline link's run, from its annotation to its glyphs, is the link's.
  let marked: StructureElement | undefined
  if (link) {
    const { target, element } = scope.tags?.inlineLink(node, link) ?? { target: link, element: undefined }
    marked = scope.leaf === undefined ? undefined : element
    if (marked !== undefined) writer.beginMarked(marked)
    // The link area is the run's glyphs, from its ascent to its descent, as
    // an inline box in CSS: a line puts its leading (a line height above the
    // font's, a line gap) below the glyphs, so an area as high as the line
    // height would reach into the line above.
    if (isDestination(target)) writer.linkToDestination(0, -ascent, xAdvance, ascent - descent, target.slice(1), element, String.fromCodePoint(...run.glyphs.flatMap(glyph => glyph.codePoints)))
    else writer.linkToUri(0, -ascent, xAdvance, ascent - descent, target, element)
  }
  // A copy: inline images replace their glyph with a space for this paint only.
  const glyphs = [...run.glyphs]
  renderInlineImages(writer, run, glyphs, scope)
  renderLeaders(writer, run, glyphs, scope)
  writer.glyphs({ font, size: fontSize, ...paintedGlyphs(font, glyphs, run.positions) })
  if (marked !== undefined) writer.endMarked()
  translate(writer, xAdvance, shift)
}

const renderDecorationLine = (writer: PdfWriter, line: Decoration): void => {
  const color = paintColor(line.color)
  const { x, y, width, height } = line.rect
  writer.save()
  writer.lineWidth(height)
  writer.strokeOpacity(color.alpha * (line.opacity ?? 1))
  if (/dashed/.test(line.style)) writer.dash([3 * height, 3 * height])
  else if (/dotted/.test(line.style)) writer.dash([height, height])
  // Validation admits solid, dashed and dotted (authoring.ts), so the old
  // painter's wavy and double lines are not ported.
  writer.moveTo(x, y)
  writer.lineTo(x + width, y)
  writer.strokeColor(color.rgb)
  writer.stroke()
  writer.restore()
}

const renderLine = (writer: PdfWriter, line: Line, node: MeasuredNode, scope: PaintScope): void => {
  if (!line.box) return
  writer.save()
  translate(writer, line.box.x, line.box.y + line.baseline)
  line.runs.forEach((run, index) => {
    if (run.attributes.backgroundColor) {
      // The last run's background stops at the box edge when its glyphs overflow it.
      const overflowRight = index === line.runs.length - 1 ? line.overflowRight ?? 0 : 0
      // As in CSS, a run's background fills its glyph box (its content
      // area, with its shift), not the line's leading.
      const { ascent = 0, descent = 0 } = run
      const shift = run.attributes.baselineShift || 0
      renderRunBackground(writer, { x: 0, y: -(ascent + shift), height: ascent - descent, width: (run.xAdvance ?? 0) - overflowRight }, run.attributes.backgroundColor)
    }
    renderRun(writer, run, node, scope)
  })
  writer.restore()
  writer.save()
  translate(writer, line.box.x, line.box.y)
  for (const decoration of line.decorationLines ?? []) renderDecorationLine(writer, decoration)
  writer.restore()
}

export const renderText = (writer: PdfWriter, node: MeasuredNode, scope: PaintScope): void => {
  if (!node.lines) return
  const content = contentBox(node.box)
  const initialY = node.lines[0] ? node.lines[0].box!.y : 0
  writer.save()
  translate(writer, content.left - (node.alignOffset || 0), content.top - initialY)
  for (const line of node.lines) renderLine(writer, line, node, scope)
  writer.restore()
}
