import type { PdfWriter, StructureElement } from '../pdf/writer'
import type { PaintLeaf, PaintTags } from '../tagged'

// The painter reads the layout's own types (layout/types.ts): every
// element of a laid-out page is a `MeasuredNode`, with the box yoga computed;
// a string inside a text or a note is a `StringNode`.

import type { MeasuredNode } from '../layout/types'

/** A child of a laid-out node: an element or a string. */
export type PaintChild = MeasuredNode['children'][number]

/** Writes the form field of a `TEXT_INPUT` node at its box (`prepareForm` in forms.ts). */
export type FieldPainter = (writer: PdfWriter, name: string, x: number, y: number, width: number, height: number, element: StructureElement | undefined) => void

/** What a painter needs beyond its node. */
export interface PaintScope {
  /** The answers of `prepareTagging`, in a tagged document. */
  readonly tags: PaintTags | undefined
  readonly paintField: FieldPainter | undefined
  /**
   * The leaf being painted when its inline links and images are tagged on
   * their own: not a figure (whose content is all its own) and not a
   * repeated header's pagination artifact.
   */
  readonly leaf: PaintLeaf | undefined
  /** The ids of nested texts that have their destination (`renderText`). */
  readonly nestedIds: Set<string>
}
