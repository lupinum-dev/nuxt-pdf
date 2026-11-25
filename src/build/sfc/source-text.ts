// Positions in the authored text: offsets and lines, offset-keeping edits, the source map and dev source positions.

import remapping, { type SourceMapSegment } from '@jridgewell/remapping'
import { PDF_SOURCE_PROP } from '../../runtime/shared/template'
import type { PdfSourceMap } from './compile'
import { ATTRIBUTE_NODE, COMPONENT_TAG, pascalTag, PDF_COMPONENT_TAGS, TEXT_NODE } from './template-ast'
import type { NodeTransform } from './vue-compiler'

/** `text` in place of `source.slice(start, end)`. */
export type TextEdit = { end: number, start: number, text: string }

/** Applies edits that do not overlap; every offset refers to `source`. */
export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce((result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end), source)
}

/**
 * The authored offset of an offset in the class-rewritten source. The edits
 * are sorted, and each one before the offset moved it; an offset inside a
 * replacement maps to the start of the authored attribute.
 */
function authoredOffset(offset: number, edits: readonly TextEdit[]): number {
  let delta = 0
  for (const edit of edits) {
    const start = edit.start + delta
    if (offset < start) break
    if (offset < start + edit.text.length) return edit.start
    delta += edit.text.length - (edit.end - edit.start)
  }
  return offset - delta
}

/**
 * The compiler maps into the class-rewritten source. The class edits keep
 * every line but move the columns after them, so each traced position is moved
 * back to the authored column. A position inside a replacement maps to the
 * start of the authored attribute. Style blanking and the `definePdf`
 * removal keep every offset, so the edits are the only difference.
 */
export function restoreAuthoredColumns(
  map: ReturnType<typeof remapping>,
  rewritten: string,
  authored: string,
  edits: readonly TextEdit[],
): PdfSourceMap {
  const { mappings } = map
  const file = map.file ?? undefined
  // The one caller asks `remapping` for decoded mappings; its type allows both forms.
  if (typeof mappings === 'string') throw new TypeError('restoreAuthoredColumns needs decoded mappings.')
  return remapping({
    ...map,
    file,
    mappings: edits.length === 0 ? mappings : restoreColumns(mappings, rewritten, authored, edits),
  }, () => null) as PdfSourceMap
}

/** Decoded mappings into the rewritten source as mappings into the authored one. Lines and columns count from 0. */
function restoreColumns(
  mappings: readonly (readonly SourceMapSegment[])[],
  rewritten: string,
  authored: string,
  edits: readonly TextEdit[],
): SourceMapSegment[][] {
  const rewrittenText = textPositions(rewritten)
  const authoredText = textPositions(authored)
  return mappings.map(line => line.map((segment): SourceMapSegment => {
    if (segment.length === 1) return segment
    const position = authoredText.position(authoredOffset(rewrittenText.offset(segment[2] + 1, segment[3] + 1), edits))
    return segment.length === 4
      ? [segment[0], segment[1], position.line - 1, position.column - 1]
      : [segment[0], segment[1], position.line - 1, position.column - 1, segment[4]]
  }))
}

/**
 * Adds `PDF_SOURCE_PROP="<file>:<line>:<column>"` to every `Pdf*` element.
 * The compiler sees the class-rewritten source, so each element offset is
 * mapped back through the class edits to the authored `.vue` file. A compiler
 * transform, not a text edit: later compiler errors keep their columns.
 * `baseOffset` turns a template-relative offset into a file offset.
 */
export function sourcePositionTransform(
  original: string,
  edits: readonly TextEdit[],
  file: string,
  baseOffset: number,
): NodeTransform {
  const originalText = textPositions(original)
  return (node) => {
    if (!('tagType' in node) || node.tagType !== COMPONENT_TAG) return
    if (!PDF_COMPONENT_TAGS.has(pascalTag(node.tag))) return

    const { column, line } = originalText.position(authoredOffset(baseOffset + node.loc.start.offset, edits))

    // First, so the renderer has it before any other prop can fail.
    node.props.unshift({
      type: ATTRIBUTE_NODE,
      name: PDF_SOURCE_PROP,
      nameLoc: node.loc,
      value: { type: TEXT_NODE, content: `${file}:${line}:${column}`, loc: node.loc },
      loc: node.loc,
    })
  }
}

/** Every character that does not end a line: `\r` and `\n` both stay. */
const NOT_LINE_BREAK = /[^\r\n]/g

/**
 * `text` as spaces with its line breaks kept, so no later offset, line or
 * column moves. The one rule for blanking authored text (style blocks, the
 * `definePdf` statement, consumed class attributes).
 */
export const blankText = (text: string): string => text.replace(NOT_LINE_BREAK, ' ')

/** Only the line breaks of `text`, so the lines after it keep their numbers. */
export const lineBreaks = (text: string): string => text.replace(NOT_LINE_BREAK, '')

/** The edit that blanks `source` from `start` to `end`. */
export const blankEdit = (source: string, start: number, end: number): TextEdit =>
  ({ start, end, text: blankText(source.slice(start, end)) })

/**
 * Offsets in one text as 1-based lines and columns, and back. Only `\n` ends
 * a line, as in Vue's and Babel's positions.
 */
export function textPositions(text: string): {
  offset(line: number, column: number): number
  position(offset: number): { column: number, line: number }
} {
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) starts.push(index + 1)
  return {
    offset: (line, column) => (starts[line - 1] ?? text.length + 1) + column - 1,
    position(offset) {
      let low = 0
      let high = starts.length - 1
      while (low < high) {
        const middle = (low + high + 1) >> 1
        if (starts[middle]! <= offset) low = middle
        else high = middle - 1
      }
      return { line: low + 1, column: offset - starts[low]! + 1 }
    },
  }
}
