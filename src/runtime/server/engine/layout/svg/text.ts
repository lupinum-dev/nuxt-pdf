import type { FontDescriptor, FontStore, FontStyle } from '../../fonts'
import { PDF_PRIMITIVES } from '../../../../primitives'
import { fontStack } from '../text/fragments'
import { DEFAULT_FONT_SIZE, layoutParagraphs, type Fragment, type TextStyle } from '../../text'
import { transformText } from '../text/transform'
import type { StyledLayoutNode, StyledNode } from '../types'

type SvgNode = StyledLayoutNode
type SvgElement = StyledNode

/**
 * The text attributes of an SVG text or span, as `resolveSvgNode` left them
 * (svg/props.ts): numbers parsed, colors resolved, inherited from the parent.
 * Admission (renderer/validate-svg.ts) allows no other shape.
 */
type SpanProps = {
  x?: number
  y?: number
  fill?: string
  fontFamily?: string | string[]
  fontWeight?: FontDescriptor['fontWeight']
  fontStyle?: FontStyle
  fontSize?: number
  textDecoration?: string
  textDecorationColor?: string
  textDecorationStyle?: TextStyle['decorationStyle']
  textTransform?: string
  opacity?: number
}
const spanProps = (node: SvgElement): SpanProps => node.props as SpanProps

// An SVG text is one line per span: no box to break into.
const UNBOUNDED = 999999999999

const isDecoration = (value: unknown, line: 'underline' | 'line-through'): boolean =>
  value === line || value === 'underline line-through' || value === 'line-through underline'

/** The fragments of a span: its strings in its SVG text attributes, nested spans in theirs. */
const fragmentsOf = (fontStore: FontStore, span: SvgElement): Fragment[] => {
  const { fill = 'black', fontFamily = 'Helvetica', fontWeight, fontStyle, fontSize = DEFAULT_FONT_SIZE, textDecoration, textDecorationColor, textDecorationStyle, textTransform, opacity } = spanProps(span)
  const style: TextStyle = {
    fonts: fontStack(fontStore, typeof fontFamily === 'string' ? [fontFamily] : fontFamily, { fontWeight, fontStyle }),
    opacity,
    fontSize,
    color: fill,
    decorationStyle: textDecorationStyle,
    underline: isDecoration(textDecoration, 'underline'),
    underlineColor: textDecorationColor || fill,
    strike: isDecoration(textDecoration, 'line-through'),
    strikeColor: textDecorationColor || fill,
  }
  return (span.children ?? []).flatMap((child: SvgNode) => child.type === PDF_PRIMITIVES.TextInstance
    ? [{ string: transformText(child.value, textTransform), style }]
    : fragmentsOf(fontStore, child))
}

/**
 * Consecutive spans are separated by a space, unless the later one sets its
 * own `x`: a span without `x` and with a span after it ends in one.
 */
const withSpaces = (spans: SvgNode[]): SvgNode[] => spans.map((span, index) => {
  if (span.type !== PDF_PRIMITIVES.Tspan) return span
  const first = span.children?.[0]
  if (span.props.x !== undefined || index === spans.length - 1 || first?.type !== PDF_PRIMITIVES.TextInstance || !first.value) return span
  return { ...span, children: [{ ...first, value: `${first.value} ` }] }
})

/**
 * Lays out an SVG text: each span on one line, starting at its own `x` or
 * where the span before it ended.
 */
export const layoutSvgText = (fontStore: FontStore, text: SvgElement): SvgElement => {
  if (!text.children) return text
  let x = spanProps(text).x || 0
  const children = withSpaces(text.children).map((span) => {
    if (span.type === PDF_PRIMITIVES.TextInstance) return span
    const props = spanProps(span)
    const box = { x: props.x === undefined ? x : props.x, y: props.y || 0, width: UNBOUNDED, height: UNBOUNDED }
    const lines = layoutParagraphs(fragmentsOf(fontStore, span), box, { hyphenate: true })
    // Every span has a string, so it has a first line.
    x += lines[0]!.xAdvance
    return { ...span, lines }
  })
  return { ...text, children }
}
