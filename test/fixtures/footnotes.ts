import { PDF_PRIMITIVES } from '../../src/runtime/primitives'
import type { DocumentNode, ElementNode, Style } from '../../src/runtime/server/engine/layout/types'

// Engine trees with footnotes, built by hand in the shape the plain tree
// hands over: the page's `notes` beside its children, each a text whose
// `id` a mark links to with `#id`, and its `noteArea`, a view whose style is
// the area's.

const string = (value: string) => ({ type: PDF_PRIMITIVES.TextInstance, value })

/** A one-line flow text; `refs` adds a mark per note id at its end. */
export const flowLine = (text: string, ...refs: string[]): ElementNode => ({
  type: PDF_PRIMITIVES.Text,
  box: {},
  style: {},
  props: {},
  children: [string(text), ...refs.map(ref => ({ type: PDF_PRIMITIVES.Text, box: {}, style: { fontSize: 7 }, props: { href: `#${ref}` }, children: [string(ref)] }))],
} as ElementNode)

/** A note body of the given lines, one per string. */
export const noteBody = (id: string, lines: readonly string[], props: Record<string, unknown> = {}): ElementNode => ({
  type: PDF_PRIMITIVES.Text,
  box: {},
  style: {},
  props: { id, ...props },
  children: [string(lines.join('\n'))],
} as ElementNode)

/** `count` lines named `${prefix}1` and up. */
export const named = (prefix: string, count: number): string[] => Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`)

/**
 * One page source of 200 × 140 pt with 20 pt padding and 10 pt lines: room
 * for 10 lines, the flow from top 20 to 120. The note area has no style by
 * default (no rule, no gap), so the numbers are the design's.
 */
export const noteDocument = (children: ElementNode[], notes: ElementNode[], areaStyle: Style = {}, pageStyle: Style = {}): DocumentNode => ({
  type: PDF_PRIMITIVES.Document,
  props: { creationDate: new Date(0) },
  children: [{
    type: PDF_PRIMITIVES.Page,
    box: {},
    style: { padding: 20, fontSize: 10, lineHeight: 1, fontFamily: 'Helvetica', ...pageStyle },
    props: { size: [200, 140] },
    children,
    notes,
    noteArea: { type: PDF_PRIMITIVES.View, box: {}, style: areaStyle, props: {}, children: [] },
  }],
} as DocumentNode)
